import type { HostRef } from '@emdash/core/primitives/host/api';
import { createOperationHandler, defineOperation } from '@emdash/core/primitives/kernel/api';
import type { HostAbsolutePath } from '@emdash/core/primitives/path/api';
import { defineVersionedSchema } from '@emdash/core/primitives/versioned-schema/api';
import { decodeTmuxSessionName } from '@emdash/core/services/pty/api';
import type { SessionIntentStore } from '@emdash/core/services/session-intents/api';
import type { Logger } from '@emdash/shared/logger';
import type { Clock } from '@emdash/shared/scheduling';
import { eq, isNull } from 'drizzle-orm';
import z from 'zod';
import { nativePathFromHost } from '@core/primitives/desktop-runtime/api';
import { projectKernelResource } from '@core/primitives/operations/api/resources';
import { makePtySessionId, parsePtySessionId } from '@core/primitives/pty/api';
import type { ProjectWorkspaceRow, ProjectWorkspacesResult } from '@core/primitives/workspaces/api';
import type { AppDb } from '@core/services/app-db/node/db';
import {
  conversations,
  projects,
  tasks,
  terminals,
  workspaces,
} from '@core/services/app-db/node/schema';
import type { LifecycleOperationParams } from '@core/services/operations/node';
import type {
  OperationDefinition,
  OperationReconcileContext,
} from '@core/services/operations/node';
import {
  confirmInput,
  operationErrorSchema,
  operationResultSchema,
  operationRetryPolicy,
  runOperationStage,
} from '@core/services/operations/node';

const SESSION_TIMEOUT_MS = 30_000;

const cleanupSessionsInputSchema = defineVersionedSchema()
  .initial(
    '1',
    z.object({
      version: z.literal('1'),
      source: z.enum(['user', 'reconciler']),
      entityId: z.string(),
      projectId: z.string().optional(),
      hostRef: z.string(),
      entityName: z.string().optional(),
      hostLabel: z.string().optional(),
      workspacePath: z.string().optional(),
      acpConversationIds: z.array(z.string()),
      tuiConversationIds: z.array(z.string()),
      terminalSessionIds: z.array(z.string()),
      tmuxSessionNames: z.array(z.string()),
      confirmedAt: z.number().int().nonnegative().optional(),
      createdAt: z.number().int().nonnegative(),
    })
  )
  .build();

export type CleanupSessionsOperationInput = typeof cleanupSessionsInputSchema.Type;

export const cleanupSessionsOperation = defineOperation({
  name: 'cleanup-sessions',
  input: cleanupSessionsInputSchema,
  result: operationResultSchema,
  error: operationErrorSchema,
  key: (input) => `cleanup-sessions:${input.entityId}`,
  claims: (input) =>
    input.projectId ? projectKernelResource.mutates({ projectId: input.projectId }) : [],
  describe: (input) => input.entityName ?? 'Orphaned session',
  retry: operationRetryPolicy,
});

export const cleanupSessionsOperationContribution = {
  create: (dependencies: CleanupSessionsDependencies, runtime: OperationRuntime) => [
    createCleanupSessionsOperationDefinition(dependencies, runtime),
  ],
};

export type ReconcilerSessionCleanupInput = {
  entityId: string;
  projectId?: string;
  workspacePath?: string;
  hostRef?: string;
  acpConversationIds?: string[];
  tuiConversationIds?: string[];
  terminalSessionIds?: string[];
  tmuxSessionNames?: string[];
};

export type CleanupSessionsLifecycleContext = {
  workspace?: { id: string };
  workspacePath?: string;
};

export type CleanupSessionsTargets = {
  acpConversationIds: string[];
  tuiConversationIds: string[];
  terminalSessionIds: string[];
  tmuxSessionNames: string[];
};

export type CleanupSessionsRuntimeTerminalSession = {
  key: {
    id: string;
    workspace: {
      path: HostAbsolutePath;
      host: HostRef;
    };
  };
};

export type CleanupSessionsDependencies = {
  agentStatus: { resetToIdle(params: { conversationId: string }): Promise<void> };
  createSessionIntentStores(): { acp: SessionIntentStore; tuiAgents: SessionIntentStore };
  lifecycle: {
    resolveTargets(
      db: AppDb,
      operation: LifecycleOperationParams,
      context: CleanupSessionsLifecycleContext
    ): Promise<CleanupSessionsTargets>;
    killAcp(
      db: AppDb,
      operation: LifecycleOperationParams,
      targets: CleanupSessionsTargets
    ): Promise<void>;
    killTerminals(
      db: AppDb,
      operation: LifecycleOperationParams,
      context: CleanupSessionsLifecycleContext,
      targets: CleanupSessionsTargets
    ): Promise<void>;
  };
  logger: Pick<Logger, 'warn'>;
  resolveLifecycleOperationContext(
    db: AppDb,
    operation: LifecycleOperationParams
  ): Promise<CleanupSessionsLifecycleContext>;
  submitReconcilerWorkspaceCleanup(
    context: OperationReconcileContext,
    input: { projectId: string; workspaceId?: string; workspacePath: string; branchName?: string }
  ): Promise<void>;
  listProjectWorkspaces(projectId: string): Promise<ProjectWorkspacesResult>;
  shouldProposeWorkspaceCleanup(
    row: Pick<ProjectWorkspaceRow, 'kind' | 'path' | 'tasks'>,
    projectPath: string
  ): boolean;
  getProjectTerminals(projectId: string):
    | {
        killTmuxSessions(input: { sessionNames: string[] }): Promise<unknown>;
        listTmuxSessions(): Promise<
          | { success: true; data: Array<{ sessionName: string }> }
          | { success: false; error: unknown }
        >;
      }
    | undefined;
  runtimeSessions: {
    listAcpConversationIds(): Promise<string[]>;
    listTuiConversationIds(): Promise<string[]>;
    listTerminalSessions(): Promise<CleanupSessionsRuntimeTerminalSession[]>;
  };
};

type OperationRuntime = { db: AppDb; clock: Clock; initiatedBy?: string };

type TaskOwner = {
  taskId: string;
  projectId: string;
  taskDeletedAt: string | null;
  projectDeletedAt: string | null;
  projectPath: string;
  workspacePath: string | null;
  hostRef: string;
};

type ConversationOwner = TaskOwner & {
  conversationId: string;
};

type TerminalOwner = TaskOwner & {
  terminalId: string;
  sessionId: string;
};

type SessionCandidate = ReconcilerSessionCleanupInput & {
  acpConversationIds: string[];
  tuiConversationIds: string[];
  terminalSessionIds: string[];
  tmuxSessionNames: string[];
};

export function createCleanupSessionsOperationDefinition(
  dependencies: CleanupSessionsDependencies,
  runtime: OperationRuntime
): OperationDefinition<typeof cleanupSessionsOperation> {
  const handler = createOperationHandler(cleanupSessionsOperation, async (ctx) => {
    const operation = lifecycleParams(ctx.operationId, ctx.input, ctx.attempt, runtime.initiatedBy);
    const context = await dependencies.resolveLifecycleOperationContext(runtime.db, operation);
    const targets = await dependencies.lifecycle.resolveTargets(runtime.db, operation, context);
    if (targets.acpConversationIds.length > 0) {
      await runOperationStage(ctx, {
        id: 'kill-acp-sessions',
        timeoutMs: SESSION_TIMEOUT_MS,
        clock: runtime.clock,
        run: async () => dependencies.lifecycle.killAcp(runtime.db, operation, targets),
      });
    }
    if (
      targets.tuiConversationIds.length > 0 ||
      targets.terminalSessionIds.length > 0 ||
      targets.tmuxSessionNames.length > 0
    ) {
      await runOperationStage(ctx, {
        id: 'kill-tui-sessions',
        timeoutMs: SESSION_TIMEOUT_MS,
        clock: runtime.clock,
        run: async () =>
          dependencies.lifecycle.killTerminals(runtime.db, operation, context, targets),
      });
    }
    return { ok: true as const };
  });

  return {
    definition: cleanupSessionsOperation,
    handler,
    entityKind: 'task',
    examples: [
      {
        definition: cleanupSessionsOperation,
        input: {
          version: '1',
          source: 'reconciler',
          entityId: 'session-example',
          projectId: 'project-example',
          hostRef: 'local',
          acpConversationIds: ['conversation-example'],
          tuiConversationIds: [],
          terminalSessionIds: [],
          tmuxSessionNames: [],
          createdAt: 1,
        },
      },
    ],
    describe: (input) => ({
      entityName: input.entityName ?? 'Orphaned session',
      workspacePath: input.workspacePath,
      hostLabel: input.hostLabel,
    }),
    projectId: (input) => input.projectId,
    hostRef: (input) => input.hostRef,
    confirmedInput: (input, confirmedAt) => confirmInput(input, confirmedAt),
    reconcile: (context) => sweepLifecycleDrift(dependencies, context),
  };
}

export async function sweepLifecycleDrift(
  dependencies: CleanupSessionsDependencies,
  context: OperationReconcileContext
): Promise<void> {
  const { db } = context;
  const [taskOwners, conversationOwners, terminalOwners] = await Promise.all([
    loadTaskOwners(db),
    loadConversationOwners(db),
    loadTerminalOwners(db),
  ]);
  const ownerByTaskId = new Map(taskOwners.map((owner) => [owner.taskId, owner]));
  const ownerByWorkspacePath = new Map(
    taskOwners
      .filter((owner): owner is TaskOwner & { workspacePath: string } => !!owner.workspacePath)
      .map((owner) => [owner.workspacePath, owner])
  );
  const conversationOwnerById = new Map(
    conversationOwners.map((owner) => [owner.conversationId, owner])
  );
  const terminalOwnerBySessionId = new Map(terminalOwners.map((owner) => [owner.sessionId, owner]));
  const validConversationIds = new Set(
    conversationOwners.filter(isOwnerActive).map((owner) => owner.conversationId)
  );
  const validTerminalSessionIds = new Set(
    terminalOwners.filter(isOwnerActive).map((owner) => owner.sessionId)
  );
  const intentContext = await loadAndPruneSessionIntents(dependencies, validConversationIds);
  for (const owner of conversationOwners.filter((candidate) => !isOwnerActive(candidate))) {
    await dependencies.agentStatus.resetToIdle({ conversationId: owner.conversationId });
  }

  const [acpConversationIds, tuiConversationIds, terminalSessions] = await Promise.all([
    dependencies.runtimeSessions.listAcpConversationIds(),
    dependencies.runtimeSessions.listTuiConversationIds(),
    dependencies.runtimeSessions.listTerminalSessions(),
  ]);
  const candidates = new Map<string, SessionCandidate>();

  for (const conversationId of acpConversationIds) {
    if (validConversationIds.has(conversationId)) continue;
    const owner =
      conversationOwnerById.get(conversationId) ??
      ownerByWorkspacePath.get(intentContext.get(conversationId) ?? '');
    sessionCandidate(candidates, `conversation:${conversationId}`, owner).acpConversationIds.push(
      conversationId
    );
  }
  for (const conversationId of tuiConversationIds) {
    if (validConversationIds.has(conversationId)) continue;
    const owner =
      conversationOwnerById.get(conversationId) ??
      ownerByWorkspacePath.get(intentContext.get(conversationId) ?? '');
    sessionCandidate(candidates, `conversation:${conversationId}`, owner).tuiConversationIds.push(
      conversationId
    );
  }
  for (const session of terminalSessions) {
    if (validTerminalSessionIds.has(session.key.id)) continue;
    const parsed = parsePtySessionId(session.key.id);
    const owner =
      terminalOwnerBySessionId.get(session.key.id) ??
      (parsed ? ownerByTaskId.get(parsed.scopeId) : undefined);
    const candidate = sessionCandidate(candidates, `pty:${session.key.id}`, owner);
    candidate.projectId ??= parsed?.projectId;
    candidate.workspacePath ??= nativePathFromHost(session.key.workspace.path);
    candidate.hostRef ??=
      session.key.workspace.host.type === 'local' ? 'local' : session.key.workspace.host.id;
    candidate.terminalSessionIds.push(session.key.id);
  }

  const wantedTmuxSessionIds = new Set([
    ...conversationOwners
      .filter(isOwnerActive)
      .map((owner) => makePtySessionId(owner.projectId, owner.taskId, owner.conversationId)),
    ...validTerminalSessionIds,
  ]);
  for (const project of await loadActiveProjects(db)) {
    const projectTerminals = dependencies.getProjectTerminals(project.id);
    if (!projectTerminals) continue;
    try {
      const result = await projectTerminals.listTmuxSessions();
      if (!result.success) continue;
      for (const { sessionName } of result.data) {
        const sessionId = decodeTmuxSessionName(sessionName);
        if (!sessionId || wantedTmuxSessionIds.has(sessionId)) continue;
        const parsed = parsePtySessionId(sessionId);
        if (!parsed || parsed.projectId !== project.id) continue;
        const owner = ownerByTaskId.get(parsed.scopeId);
        const candidate = sessionCandidate(candidates, `pty:${sessionId}`, owner);
        candidate.projectId ??= parsed.projectId;
        candidate.hostRef ??= project.sshConnectionId ?? 'local';
        candidate.tmuxSessionNames.push(sessionName);
      }
    } catch (error) {
      dependencies.logger.warn('lifecycle reconciler tmux scan failed', {
        projectId: project.id,
        error: String(error),
      });
    }
  }
  for (const candidate of candidates.values()) {
    await submitReconcilerSessionCleanup(context, candidate);
  }

  for (const project of await loadActiveProjects(db)) {
    try {
      const result = await dependencies.listProjectWorkspaces(project.id);
      for (const row of result.rows) {
        if (!dependencies.shouldProposeWorkspaceCleanup(row, project.path)) continue;
        await dependencies.submitReconcilerWorkspaceCleanup(context, {
          projectId: project.id,
          workspaceId: row.workspaceId ?? undefined,
          workspacePath: row.path,
          branchName: row.branch,
        });
      }
    } catch (error) {
      dependencies.logger.warn('lifecycle reconciler workspace scan failed', {
        projectId: project.id,
        error: String(error),
      });
    }
  }
}

async function submitReconcilerSessionCleanup(
  context: OperationReconcileContext,
  input: ReconcilerSessionCleanupInput
): Promise<void> {
  const operationInput: CleanupSessionsOperationInput = {
    version: '1',
    source: 'reconciler',
    entityId: input.entityId,
    projectId: input.projectId,
    hostRef: input.hostRef ?? 'local',
    entityName: 'Orphaned session',
    workspacePath: input.workspacePath,
    acpConversationIds: input.acpConversationIds ?? [],
    tuiConversationIds: input.tuiConversationIds ?? [],
    terminalSessionIds: input.terminalSessionIds ?? [],
    tmuxSessionNames: input.tmuxSessionNames ?? [],
    createdAt: context.clock.now(),
  };
  if (await context.hasActiveKey(cleanupSessionsOperation.key(operationInput))) return;
  await context.submit(cleanupSessionsOperation, operationInput);
}

function sessionCandidate(
  candidates: Map<string, SessionCandidate>,
  key: string,
  owner?: TaskOwner
): SessionCandidate {
  const existing = candidates.get(key);
  if (existing) return existing;
  const candidate: SessionCandidate = {
    entityId: `reconciler-session:${key}`,
    projectId: owner?.projectId,
    workspacePath: owner?.workspacePath ?? undefined,
    hostRef: owner?.hostRef,
    acpConversationIds: [],
    tuiConversationIds: [],
    terminalSessionIds: [],
    tmuxSessionNames: [],
  };
  candidates.set(key, candidate);
  return candidate;
}

function lifecycleParams(
  operationId: string,
  input: CleanupSessionsOperationInput,
  attempt: number,
  initiatedBy?: string
): LifecycleOperationParams {
  return {
    operationId,
    kind: 'cleanup-sessions',
    projectId: input.projectId ?? null,
    entityKey: input.entityId,
    hostRef: input.hostRef,
    payload: {
      version: '2',
      source: input.source,
      entityName: input.entityName,
      hostLabel: input.hostLabel,
      workspacePath: input.workspacePath,
      acpConversationIds: input.acpConversationIds,
      tuiConversationIds: input.tuiConversationIds,
      terminalSessionIds: input.terminalSessionIds,
      tmuxSessionNames: input.tmuxSessionNames,
    },
    confirmedAt: input.confirmedAt ?? null,
    createdAt: input.createdAt,
    initiatedBy: initiatedBy ?? null,
    attempt,
  };
}

async function loadTaskOwners(db: AppDb): Promise<TaskOwner[]> {
  return db
    .select({
      taskId: tasks.id,
      projectId: tasks.projectId,
      taskDeletedAt: tasks.deletedAt,
      projectDeletedAt: projects.deletedAt,
      projectPath: projects.path,
      workspacePath: workspaces.path,
      workspaceSshConnectionId: workspaces.sshConnectionId,
      projectSshConnectionId: projects.sshConnectionId,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(workspaces, eq(workspaces.id, tasks.workspaceId))
    .then((rows) =>
      rows.map(({ workspaceSshConnectionId, projectSshConnectionId, ...owner }) => ({
        ...owner,
        hostRef: workspaceSshConnectionId ?? projectSshConnectionId ?? 'local',
      }))
    );
}

async function loadConversationOwners(db: AppDb): Promise<ConversationOwner[]> {
  return db
    .select({
      conversationId: conversations.id,
      taskId: tasks.id,
      projectId: tasks.projectId,
      taskDeletedAt: tasks.deletedAt,
      projectDeletedAt: projects.deletedAt,
      projectPath: projects.path,
      workspacePath: workspaces.path,
      workspaceSshConnectionId: workspaces.sshConnectionId,
      projectSshConnectionId: projects.sshConnectionId,
    })
    .from(conversations)
    .innerJoin(tasks, eq(tasks.id, conversations.taskId))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(workspaces, eq(workspaces.id, tasks.workspaceId))
    .then((rows) =>
      rows.map(({ workspaceSshConnectionId, projectSshConnectionId, ...owner }) => ({
        ...owner,
        hostRef: workspaceSshConnectionId ?? projectSshConnectionId ?? 'local',
      }))
    );
}

async function loadTerminalOwners(db: AppDb): Promise<TerminalOwner[]> {
  return db
    .select({
      terminalId: terminals.id,
      taskId: tasks.id,
      projectId: tasks.projectId,
      taskDeletedAt: tasks.deletedAt,
      projectDeletedAt: projects.deletedAt,
      projectPath: projects.path,
      workspacePath: workspaces.path,
      workspaceSshConnectionId: workspaces.sshConnectionId,
      projectSshConnectionId: projects.sshConnectionId,
    })
    .from(terminals)
    .innerJoin(tasks, eq(tasks.id, terminals.taskId))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(workspaces, eq(workspaces.id, tasks.workspaceId))
    .then((rows) =>
      rows.map(({ terminalId, workspaceSshConnectionId, projectSshConnectionId, ...owner }) => ({
        ...owner,
        terminalId,
        sessionId: `${owner.projectId}:${owner.taskId}:${terminalId}`,
        hostRef: workspaceSshConnectionId ?? projectSshConnectionId ?? 'local',
      }))
    );
}

async function loadActiveProjects(
  db: AppDb
): Promise<Array<{ id: string; path: string; sshConnectionId: string | null }>> {
  return db
    .select({
      id: projects.id,
      path: projects.path,
      sshConnectionId: projects.sshConnectionId,
    })
    .from(projects)
    .where(isNull(projects.deletedAt));
}

async function loadAndPruneSessionIntents(
  dependencies: Pick<CleanupSessionsDependencies, 'createSessionIntentStores' | 'logger'>,
  validConversationIds: Set<string>
): Promise<Map<string, string>> {
  const intentStores = dependencies.createSessionIntentStores();
  const context = new Map<string, string>();
  for (const store of [intentStores.acp, intentStores.tuiAgents]) {
    const result = await store.list();
    if (!result.success) {
      dependencies.logger.warn('lifecycle reconciler could not read session intents', {
        error: result.error.message,
      });
      continue;
    }
    for (const intent of result.data) {
      const cwd = stringField(intent.payload, 'cwd');
      if (cwd) context.set(intent.conversationId, cwd);
      if (validConversationIds.has(intent.conversationId)) continue;
      const removed = await store.remove(intent.conversationId);
      if (!removed.success) {
        dependencies.logger.warn('lifecycle reconciler could not prune session intent', {
          conversationId: intent.conversationId,
          error: removed.error.message,
        });
      }
    }
  }
  return context;
}

function stringField(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null || !(key in value)) return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === 'string' ? field : undefined;
}

function isOwnerActive(owner: {
  taskDeletedAt: string | null;
  projectDeletedAt: string | null;
}): boolean {
  return owner.taskDeletedAt === null && owner.projectDeletedAt === null;
}
