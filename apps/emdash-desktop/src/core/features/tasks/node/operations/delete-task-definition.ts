import type { HostAbsolutePath } from '@emdash/core/primitives/path/api';
import { err, ok } from '@emdash/shared';
import { and, desc, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import { taskSubject } from '@core/features/tasks/contributions/subject';
import {
  deactivateLifecycleWorkspace,
  lifecycleWorkspaceIsDirty,
  lifecycleWorkspaceIsUnused,
  teardownLifecycleWorkspace,
} from '@core/features/workspaces/api/node/operations/lifecycle-cleanup';
import type { LifecycleCleanupDependencies } from '@core/features/workspaces/api/node/operations/lifecycle-cleanup';
import { resolveLifecycleOperationContext } from '@core/features/workspaces/api/node/operations/lifecycle-operation-context';
import type { LifecycleOperationContextDependencies } from '@core/features/workspaces/api/node/operations/lifecycle-operation-context';
import { hostPathFromNative } from '@core/primitives/desktop-runtime/api';
import {
  nonTerminalOperationStatuses,
  type OperationPayload,
} from '@core/primitives/operations/api';
import type { TelemetryService } from '@core/primitives/telemetry/api/telemetry';
import type { AppDb } from '@core/services/app-db/node/db';
import {
  lifecycleOperations,
  projects,
  tasks,
  workspaces,
  type LifecycleOperationRow,
} from '@core/services/app-db/node/schema';
import {
  isOperationStale,
  isResumedOperation,
  operationNeedsConfirmation,
  runOperationActions,
  type OperationDefinition,
  type OperationSubmit,
  type OperationsEngine,
} from '@core/services/operations/node';
import type { MementosRuntimeClient } from '@core/services/runtime-broker/api/clients';

const SESSION_TIMEOUT_MS = 30_000;
const WORKSPACE_TIMEOUT_MS = 5 * 60_000;
const PURGE_TIMEOUT_MS = 30_000;
const reconcilerDedupeStatuses = [...nonTerminalOperationStatuses, 'abandoned'] as const;

export type DeleteTaskInput = {
  taskId: string;
  deleteWorktree?: boolean;
  deleteBranch?: boolean;
};

export type DeleteTaskOperationDependencies = {
  lifecycleContext: LifecycleOperationContextDependencies;
  lifecycleCleanup: LifecycleCleanupDependencies;
  getMementosRuntimeClient(): Promise<MementosRuntimeClient>;
  sessionCleanup: {
    resolve(
      db: AppDb,
      operation: LifecycleOperationRow,
      context: Awaited<ReturnType<typeof resolveLifecycleOperationContext>>
    ): Promise<LifecycleSessionTargets>;
    killAcp(
      db: AppDb,
      operation: LifecycleOperationRow,
      targets: LifecycleSessionTargets
    ): Promise<void>;
    killTerminals(
      db: AppDb,
      operation: LifecycleOperationRow,
      context: Awaited<ReturnType<typeof resolveLifecycleOperationContext>>,
      targets: LifecycleSessionTargets
    ): Promise<void>;
  };
  telemetry: Pick<TelemetryService, 'capture'>;
  unregisterFileSearchRoot(path: HostAbsolutePath): Promise<void> | void;
};

type LifecycleSessionTargets = {
  acpConversationIds: string[];
  tuiConversationIds: string[];
  terminalSessionIds: string[];
  tmuxSessionNames: string[];
};

export function createDeleteTaskOperationDefinition(
  dependencies: DeleteTaskOperationDependencies
): OperationDefinition {
  const { sessionCleanup } = dependencies;
  return {
    kind: 'delete-task',
    entityKind: 'task',
    async describe({ operation, db }) {
      const context = await resolveLifecycleOperationContext(
        dependencies.lifecycleContext,
        db,
        operation
      );
      return {
        entityName: context.task?.name ?? context.project?.name ?? context.workspacePath,
        workspacePath: context.workspacePath,
        branchName: context.branchName,
      };
    },
    async run(runContext) {
      const { operation, db, clock } = runContext;
      const context = await resolveLifecycleOperationContext(
        dependencies.lifecycleContext,
        db,
        operation,
        {
          resolveRuntimeConfig: true,
        }
      );
      const [targets, otherTaskRows] = await Promise.all([
        sessionCleanup.resolve(db, operation, context),
        context.task?.workspaceId
          ? db
              .select({ id: tasks.id })
              .from(tasks)
              .where(
                and(
                  eq(tasks.workspaceId, context.task.workspaceId),
                  ne(tasks.id, context.task.id),
                  isNull(tasks.deletedAt)
                )
              )
              .limit(1)
          : Promise.resolve([]),
      ]);
      const workspaceSharedWithLiveTasks = otherTaskRows.length > 0;
      const shouldTeardown =
        operation.payload.deleteWorktree !== false &&
        !workspaceSharedWithLiveTasks &&
        (context.workspace?.kind === 'worktree' || context.workspace?.kind === 'byoi') &&
        !!context.workspace.path;

      if (context.task && isOperationStale(operation, clock.now())) {
        return operationNeedsConfirmation('stale');
      }
      if (
        context.task &&
        shouldTeardown &&
        isResumedOperation(operation, clock.now()) &&
        !operation.payload.confirmedAt &&
        (await lifecycleWorkspaceIsDirty(dependencies.lifecycleCleanup, operation, context))
      ) {
        return operationNeedsConfirmation('workspace-modified');
      }

      const actions = [];
      if (targets.acpConversationIds.length > 0) {
        actions.push({
          id: 'kill-acp-sessions',
          timeoutMs: SESSION_TIMEOUT_MS,
          run: async () => sessionCleanup.killAcp(db, operation, targets),
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
          run: async () => sessionCleanup.killTerminals(db, operation, context, targets),
        });
      }
      if (context.task && context.workspace?.path) {
        actions.push({
          id: 'deactivate-workspace',
          timeoutMs: WORKSPACE_TIMEOUT_MS,
          run: async () =>
            deactivateLifecycleWorkspace(dependencies.lifecycleCleanup, operation, context),
        });
      }
      if (context.task && shouldTeardown) {
        actions.push({
          id: 'teardown-workspace',
          timeoutMs: WORKSPACE_TIMEOUT_MS,
          run: async () =>
            teardownLifecycleWorkspace(dependencies.lifecycleCleanup, db, operation, context),
        });
      }
      if (context.task) {
        actions.push({
          id: 'purge-task-rows',
          timeoutMs: PURGE_TIMEOUT_MS,
          run: async () => purgeTaskRows(db, operation, context, dependencies),
        });
      }
      return runOperationActions(runContext, actions);
    },
    async forget({ operation, db, markAbandoned }) {
      db.transaction((tx) => {
        markAbandoned(tx);
        tx.delete(tasks).where(eq(tasks.id, operation.entityKey!)).run();
      });
      if (operation.entityKey) {
        await purgeTaskLocalState(
          {
            projectId: operation.projectId,
            taskId: operation.entityKey,
          },
          dependencies
        );
      }
    },
  };
}

export async function enqueueDeleteTask(operations: OperationsEngine, input: DeleteTaskInput) {
  return operations.submit(async ({ db, clock }) => {
    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, input.taskId), isNull(tasks.deletedAt)))
      .limit(1);
    if (!task) {
      const [existing] = await db
        .select({ id: lifecycleOperations.id })
        .from(lifecycleOperations)
        .where(
          and(
            eq(lifecycleOperations.entityKey, input.taskId),
            inArray(lifecycleOperations.kind, ['delete-task', 'cleanup-sessions']),
            inArray(lifecycleOperations.status, [...nonTerminalOperationStatuses])
          )
        )
        .orderBy(desc(lifecycleOperations.createdAt))
        .limit(1);
      return existing
        ? ok({ outcome: 'existing' as const, operationId: existing.id })
        : err({ type: 'task-not-found', message: `Task ${input.taskId} was not found` });
    }

    const [workspace] = task.workspaceId
      ? await db.select().from(workspaces).where(eq(workspaces.id, task.workspaceId)).limit(1)
      : [];
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, task.projectId))
      .limit(1);
    const createdAt = clock.now();
    return ok({
      outcome: 'enqueue' as const,
      draft: {
        kind: 'delete-task' as const,
        projectId: task.projectId,
        taskId: task.id,
        workspaceId: task.workspaceId,
        entityKey: task.id,
        hostRef: workspace?.sshConnectionId ?? project?.sshConnectionId ?? 'local',
        payload: {
          version: '1' as const,
          source: 'user' as const,
          entityName: task.name,
          hostLabel: project?.sshConnectionId ? project.name : undefined,
          deleteWorktree: input.deleteWorktree ?? true,
          deleteBranch: input.deleteBranch ?? false,
        },
        createdAt,
      },
      options: {
        dedupeStatuses: nonTerminalOperationStatuses,
        tombstone: (tx) =>
          tx
            .update(tasks)
            .set({ deletedAt: new Date(createdAt).toISOString() })
            .where(and(eq(tasks.id, task.id), isNull(tasks.deletedAt)))
            .run().changes,
      },
    });
  });
}

export async function submitReconcilerTaskCleanup(
  submit: OperationSubmit,
  taskId: string
): Promise<void> {
  await submit(async ({ db, clock }) => {
    const [existing] = await db
      .select({ id: lifecycleOperations.id })
      .from(lifecycleOperations)
      .where(
        and(
          eq(lifecycleOperations.entityKey, taskId),
          inArray(lifecycleOperations.kind, ['delete-task', 'cleanup-sessions']),
          inArray(lifecycleOperations.status, [...reconcilerDedupeStatuses])
        )
      )
      .limit(1);
    if (existing) return ok({ outcome: 'existing' as const, operationId: existing.id });

    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (!task) return ok({ outcome: 'existing' as const });
    const [workspace] = task.workspaceId
      ? await db.select().from(workspaces).where(eq(workspaces.id, task.workspaceId)).limit(1)
      : [];
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, task.projectId))
      .limit(1);
    const createdAt = clock.now();
    const payload: OperationPayload = {
      version: '1',
      source: 'reconciler',
      entityName: task.name,
      hostLabel: project?.name,
      deleteWorktree: true,
      deleteBranch: false,
      confirmationReason: 'reconciler-proposed',
    };
    return ok({
      outcome: 'enqueue' as const,
      draft: {
        kind: 'delete-task' as const,
        status: 'awaiting-confirmation' as const,
        projectId: task.projectId,
        taskId: task.id,
        workspaceId: task.workspaceId,
        entityKey: task.id,
        hostRef: workspace?.sshConnectionId ?? project?.sshConnectionId ?? 'local',
        payload,
        createdAt,
      },
      options: {
        dedupeStatuses: reconcilerDedupeStatuses,
        tombstone: (tx) => {
          tx.update(tasks)
            .set({ deletedAt: task.deletedAt ?? new Date(createdAt).toISOString() })
            .where(eq(tasks.id, task.id))
            .run();
          return 1;
        },
      },
    });
  });
}

async function purgeTaskRows(
  db: Parameters<OperationDefinition['run']>[0]['db'],
  operation: Parameters<OperationDefinition['run']>[0]['operation'],
  context: Awaited<ReturnType<typeof resolveLifecycleOperationContext>>,
  dependencies: Pick<
    DeleteTaskOperationDependencies,
    'getMementosRuntimeClient' | 'telemetry' | 'unregisterFileSearchRoot'
  >
): Promise<void> {
  if (!operation.taskId) return;
  const purgeWorkspace =
    !!operation.workspaceId &&
    operation.payload.deleteWorktree !== false &&
    (await lifecycleWorkspaceIsUnused(db, operation.workspaceId));
  if (purgeWorkspace && context.workspacePath) {
    await dependencies.unregisterFileSearchRoot(hostPathFromNative(context.workspacePath));
  }
  db.transaction((tx) => {
    tx.delete(tasks).where(eq(tasks.id, operation.taskId!)).run();
    if (operation.workspaceId && purgeWorkspace) {
      tx.delete(workspaces)
        .where(
          and(
            eq(workspaces.id, operation.workspaceId),
            or(ne(workspaces.kind, 'project-root'), isNull(workspaces.kind))
          )
        )
        .run();
    }
  });
  await purgeTaskLocalState(
    { projectId: operation.projectId, taskId: operation.taskId },
    dependencies
  );
}

async function purgeTaskLocalState(
  input: {
    projectId?: string | null;
    taskId: string;
  },
  dependencies: Pick<DeleteTaskOperationDependencies, 'getMementosRuntimeClient' | 'telemetry'>
): Promise<void> {
  const client = await dependencies.getMementosRuntimeClient();
  const result = await client.deleteBySubject(taskSubject({ taskId: input.taskId }));
  if (!result.success) throw new Error(result.error.message);
  dependencies.telemetry.capture('task_deleted', {
    project_id: input.projectId ?? undefined,
    task_id: input.taskId,
  });
}
