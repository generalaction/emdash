import type { HostRef } from '@emdash/core/primitives/host/api';
import { createOperationHandler, defineOperation } from '@emdash/core/primitives/kernel/api';
import type { HostAbsolutePath } from '@emdash/core/primitives/path/api';
import { defineVersionedSchema } from '@emdash/core/primitives/versioned-schema/api';
import type { SessionIntentStore } from '@emdash/core/services/session-intents/api';
import type { Logger } from '@emdash/shared/logger';
import type { Clock } from '@emdash/shared/scheduling';
import z from 'zod';
import { nativePathFromHost } from '@core/primitives/desktop-runtime/api';
import { projectKernelResource } from '@core/primitives/operations/api/resources';
import type { ProjectWorkspaceRow, ProjectWorkspacesResult } from '@core/primitives/workspaces/api';
import type { AppDb } from '@core/services/app-db/node/db';
import { conversations, terminals } from '@core/services/app-db/node/schema';
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
  listTombstonedAutomationIds(db: AppDb): Promise<string[]>;
  submitReconcilerAutomationCleanup(
    submit: OperationReconcileContext['submit'],
    automationId: string
  ): Promise<void>;
  submitReconcilerProjectCleanup(
    submit: OperationReconcileContext['submit'],
    projectId: string
  ): Promise<void>;
  submitReconcilerTaskCleanup(
    submit: OperationReconcileContext['submit'],
    taskId: string
  ): Promise<void>;
  submitReconcilerWorkspaceCleanup(
    submit: OperationReconcileContext['submit'],
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
  const [validConversationIds, validTerminalSessionIds] = await Promise.all([
    loadValidConversationIds(context.db),
    loadValidTerminalSessionIds(context.db),
  ]);
  await pruneSessionIntents(dependencies, validConversationIds);
  const [acpConversationIds, tuiConversationIds, terminalSessions] = await Promise.all([
    dependencies.runtimeSessions.listAcpConversationIds(),
    dependencies.runtimeSessions.listTuiConversationIds(),
    dependencies.runtimeSessions.listTerminalSessions(),
  ]);

  for (const conversationId of acpConversationIds) {
    if (validConversationIds.has(conversationId)) continue;
    await submitReconcilerSessionCleanup(context, {
      entityId: `conversation:${conversationId}`,
      acpConversationIds: [conversationId],
    });
    await dependencies.agentStatus.resetToIdle({ conversationId });
  }
  for (const conversationId of tuiConversationIds) {
    if (validConversationIds.has(conversationId)) continue;
    await submitReconcilerSessionCleanup(context, {
      entityId: `conversation:${conversationId}`,
      tuiConversationIds: [conversationId],
    });
    await dependencies.agentStatus.resetToIdle({ conversationId });
  }
  for (const session of terminalSessions) {
    if (validTerminalSessionIds.has(session.key.id)) continue;
    await submitReconcilerSessionCleanup(context, {
      entityId: `pty:${session.key.id}`,
      workspacePath: nativePathFromHost(session.key.workspace.path),
      hostRef:
        session.key.workspace.host.type === 'local' ? 'local' : session.key.workspace.host.id,
      terminalSessionIds: [session.key.id],
    });
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

async function loadValidConversationIds(db: AppDb): Promise<Set<string>> {
  const rows = await db.select({ id: conversations.id }).from(conversations);
  return new Set(rows.map((row) => row.id));
}

async function loadValidTerminalSessionIds(db: AppDb): Promise<Set<string>> {
  const rows = await db.select({ id: terminals.id }).from(terminals);
  return new Set(rows.map((row) => row.id));
}

async function pruneSessionIntents(
  dependencies: Pick<CleanupSessionsDependencies, 'createSessionIntentStores' | 'logger'>,
  validConversationIds: Set<string>
): Promise<void> {
  const intentStores = dependencies.createSessionIntentStores();
  for (const store of [intentStores.acp, intentStores.tuiAgents]) {
    const result = await store.list();
    if (!result.success) {
      dependencies.logger.warn('lifecycle reconciler could not read session intents', {
        error: result.error.message,
      });
      continue;
    }
    for (const intent of result.data) {
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
}
