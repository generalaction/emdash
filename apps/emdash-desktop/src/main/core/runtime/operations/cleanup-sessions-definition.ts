import { decodeTmuxSessionName, listTmuxSessionActivity } from '@emdash/core/services/pty/api';
import { ok } from '@emdash/shared';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { nativePathFromHost } from '@core/primitives/desktop-runtime/api';
import { nonTerminalOperationStatuses } from '@core/primitives/operations/api';
import { makePtySessionId, parsePtySessionId } from '@core/primitives/pty/api';
import type { AppDb } from '@core/services/app-db/node/db';
import {
  lifecycleOperations,
  conversations,
  projects,
  tasks,
  terminals,
  workspaces,
} from '@core/services/app-db/node/schema';
import {
  runOperationActions,
  type OperationDefinition,
  type OperationReconcileContext,
  type OperationSubmit,
} from '@core/services/operations/node';
import { agentStatusService } from '@main/core/agent-status/agent-status-service';
import { submitReconcilerProjectCleanup } from '@main/core/projects/operations/delete-project-definition';
import { projectManager } from '@main/core/projects/project-manager';
import { createDesktopSessionIntentStores } from '@main/core/runtime/session-intent-stores';
import { submitReconcilerTaskCleanup } from '@main/core/tasks/operations/delete-task-definition';
import { resolveLifecycleOperationContext } from '@main/core/workspaces/operations/lifecycle-operation-context';
import { listProjectWorkspaces } from '@main/core/workspaces/operations/list-project-workspaces';
import { submitReconcilerWorkspaceCleanup } from '@main/core/workspaces/operations/workspace-lifecycle-definitions';
import { shouldProposeWorkspaceCleanup } from '@main/core/workspaces/operations/workspace-reconciliation-policy';
import {
  getAcpRuntimeClient,
  getTerminalsRuntimeClient,
  getTuiAgentsRuntimeClient,
} from '@main/gateway/accessors';
import { log } from '@main/lib/logger';
import {
  killLifecycleAcpSessions,
  killLifecycleTerminalSessions,
  resolveLifecycleSessionTargets,
} from './session-cleanup';

const SESSION_TIMEOUT_MS = 30_000;
const reconcilerDedupeStatuses = [...nonTerminalOperationStatuses, 'abandoned'] as const;

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

type TaskOwner = {
  taskId: string;
  projectId: string;
  taskDeletedAt: string | null;
  projectDeletedAt: string | null;
  projectPath: string;
  workspacePath: string | null;
  hostRef: string;
};

type SessionCandidate = ReconcilerSessionCleanupInput & {
  acpConversationIds: string[];
  tuiConversationIds: string[];
  terminalSessionIds: string[];
  tmuxSessionNames: string[];
};

export function createCleanupSessionsOperationDefinition(): OperationDefinition {
  return {
    kind: 'cleanup-sessions',
    entityKind: 'task',
    async describe({ operation }) {
      return {
        entityName: operation.payload.entityName ?? 'Orphaned session',
        workspacePath: operation.payload.workspacePath,
        branchName: operation.payload.branchName,
      };
    },
    async run(runContext) {
      const { db, operation } = runContext;
      const context = await resolveLifecycleOperationContext(db, operation);
      const targets = await resolveLifecycleSessionTargets(db, operation, context);
      const actions = [];
      if (targets.acpConversationIds.length > 0) {
        actions.push({
          id: 'kill-acp-sessions',
          timeoutMs: SESSION_TIMEOUT_MS,
          run: async () => killLifecycleAcpSessions(db, operation, targets),
        });
      }
      if (
        targets.tuiConversationIds.length > 0 ||
        targets.terminalSessionIds.length > 0 ||
        targets.tmuxSessionNames.length > 0
      ) {
        actions.push({
          id: 'kill-tui-sessions',
          timeoutMs: SESSION_TIMEOUT_MS,
          run: async () => killLifecycleTerminalSessions(db, operation, context, targets),
        });
      }
      return runOperationActions(runContext, actions);
    },
    reconcile: sweepLifecycleDrift,
  };
}

export async function sweepLifecycleDrift(context: OperationReconcileContext): Promise<void> {
  const { db, submit } = context;
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

  const invalidTaskIds = new Set(
    taskOwners.filter((owner) => !isOwnerActive(owner)).map((owner) => owner.taskId)
  );
  for (const taskId of invalidTaskIds) {
    await submitReconcilerTaskCleanup(submit, taskId);
  }
  for (const projectId of await loadTombstonedProjectIds(db)) {
    await submitReconcilerProjectCleanup(submit, projectId);
  }

  const intentContext = await loadAndPruneSessionIntents(validConversationIds);
  for (const owner of conversationOwners.filter((candidate) => !isOwnerActive(candidate))) {
    await agentStatusService.resetToIdle({ conversationId: owner.conversationId });
  }

  const [acpClient, tuiClient, terminalsClient] = await Promise.all([
    getAcpRuntimeClient(),
    getTuiAgentsRuntimeClient(),
    getTerminalsRuntimeClient(),
  ]);
  const [acpSessions, tuiSessions, terminalSessions] = await Promise.all([
    acpClient.sessions.state(undefined, 'list').snapshot(),
    tuiClient.sessions.state(undefined, 'list').snapshot(),
    terminalsClient.sessions.state(undefined, 'list').snapshot(),
  ]);
  const candidates = new Map<string, SessionCandidate>();

  for (const conversationId of Object.keys(acpSessions.data)) {
    if (validConversationIds.has(conversationId)) continue;
    const owner =
      conversationOwnerById.get(conversationId) ??
      ownerByWorkspacePath.get(intentContext.get(conversationId) ?? '');
    sessionCandidate(candidates, `conversation:${conversationId}`, owner).acpConversationIds.push(
      conversationId
    );
  }
  for (const conversationId of Object.keys(tuiSessions.data)) {
    if (validConversationIds.has(conversationId)) continue;
    const owner =
      conversationOwnerById.get(conversationId) ??
      ownerByWorkspacePath.get(intentContext.get(conversationId) ?? '');
    sessionCandidate(candidates, `conversation:${conversationId}`, owner).tuiConversationIds.push(
      conversationId
    );
  }
  for (const session of Object.values(terminalSessions.data)) {
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
    const provider = projectManager.getProject(project.id);
    if (!provider) continue;
    try {
      const activity = await listTmuxSessionActivity(provider.ctx);
      for (const sessionName of activity.keys()) {
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
      log.warn('lifecycle reconciler tmux scan failed', {
        projectId: project.id,
        error: String(error),
      });
    }
  }
  for (const candidate of candidates.values()) {
    await submitReconcilerSessionCleanup(submit, candidate);
  }

  for (const project of await loadActiveProjects(db)) {
    try {
      const result = await listProjectWorkspaces(project.id);
      for (const row of result.rows) {
        if (!shouldProposeWorkspaceCleanup(row, project.path)) continue;
        await submitReconcilerWorkspaceCleanup(submit, {
          projectId: project.id,
          workspaceId: row.workspaceId ?? undefined,
          workspacePath: row.path,
          branchName: row.branch,
        });
      }
    } catch (error) {
      log.warn('lifecycle reconciler workspace scan failed', {
        projectId: project.id,
        error: String(error),
      });
    }
  }
}

async function submitReconcilerSessionCleanup(
  submit: OperationSubmit,
  input: ReconcilerSessionCleanupInput
): Promise<void> {
  await submit(async ({ db }) => {
    const [existing] = await db
      .select({ id: lifecycleOperations.id })
      .from(lifecycleOperations)
      .where(
        and(
          eq(lifecycleOperations.entityKey, input.entityId),
          inArray(lifecycleOperations.kind, ['delete-task', 'cleanup-sessions']),
          inArray(lifecycleOperations.status, [...reconcilerDedupeStatuses])
        )
      )
      .limit(1);
    if (existing) return ok({ outcome: 'existing' as const, operationId: existing.id });
    return ok({
      outcome: 'enqueue' as const,
      draft: {
        kind: 'cleanup-sessions' as const,
        projectId: input.projectId,
        entityKey: input.entityId,
        hostRef: input.hostRef ?? 'local',
        payload: {
          version: '1' as const,
          source: 'reconciler' as const,
          entityName: 'Orphaned session',
          workspacePath: input.workspacePath,
          acpConversationIds: input.acpConversationIds,
          tuiConversationIds: input.tuiConversationIds,
          terminalSessionIds: input.terminalSessionIds,
          tmuxSessionNames: input.tmuxSessionNames,
        },
      },
      options: { dedupeStatuses: reconcilerDedupeStatuses },
    });
  });
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

async function loadConversationOwners(db: AppDb) {
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

async function loadTerminalOwners(db: AppDb) {
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

async function loadTombstonedProjectIds(db: AppDb): Promise<string[]> {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(isNotNull(projects.deletedAt));
  return rows.map((row) => row.id);
}

async function loadAndPruneSessionIntents(
  validConversationIds: Set<string>
): Promise<Map<string, string>> {
  const intentStores = createDesktopSessionIntentStores();
  const stores = [intentStores.acp, intentStores.tuiAgents];
  const context = new Map<string, string>();
  for (const store of stores) {
    const result = await store.list();
    if (!result.success) {
      log.warn('lifecycle reconciler could not read session intents', {
        error: result.error.message,
      });
      continue;
    }
    for (const intent of result.data) {
      const cwd = stringField(intent.payload, 'cwd');
      if (cwd) context.set(intent.conversationId, cwd);
      if (!validConversationIds.has(intent.conversationId)) {
        const removed = await store.remove(intent.conversationId);
        if (!removed.success) {
          log.warn('lifecycle reconciler could not prune session intent', {
            conversationId: intent.conversationId,
            error: removed.error.message,
          });
        }
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
