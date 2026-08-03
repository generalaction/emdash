import type { HostRef } from '@emdash/core/primitives/host/api';
import { createOperationHandler } from '@emdash/core/primitives/kernel/api';
import type { HostAbsolutePath } from '@emdash/core/primitives/path/api';
import { err, type Result } from '@emdash/shared';
import type { Clock } from '@emdash/shared/scheduling';
import { and, eq, isNotNull, isNull, ne, or } from 'drizzle-orm';
import {
  deleteTaskOperation,
  type DeleteTaskOperationInput,
} from '@core/features/tasks/api/node/delete-task-operation';
import { taskSubject } from '@core/features/tasks/contributions/subject';
import { classifyWorkspaceOperationError } from '@core/features/workspaces/api/node/operation-error-classifier';
import {
  deactivateLifecycleWorkspace,
  lifecycleWorkspaceIsDirty,
  lifecycleWorkspaceIsUnused,
  teardownLifecycleWorkspace,
} from '@core/features/workspaces/api/node/operations/lifecycle-cleanup';
import type { LifecycleCleanupDependencies } from '@core/features/workspaces/api/node/operations/lifecycle-cleanup';
import { resolveLifecycleOperationContext } from '@core/features/workspaces/api/node/operations/lifecycle-operation-context';
import type { LifecycleOperationContextDependencies } from '@core/features/workspaces/api/node/operations/lifecycle-operation-context';
import { hostFileRefFromNativePath } from '@core/primitives/desktop-runtime/api';
import type { TelemetryService } from '@core/primitives/telemetry/api/telemetry';
import type { AppDb, DrizzleTx } from '@core/services/app-db/node/db';
import { appDbPokes } from '@core/services/app-db/node/pokes';
import { projects, tasks, workspaces } from '@core/services/app-db/node/schema';
import type {
  LifecycleOperationParams,
  OperationDefinition,
  OperationReconcileContext,
  OperationSubmitOptions,
} from '@core/services/operations/node';
import {
  confirmInput,
  isOperationStale,
  isResumedOperation,
  needsConfirmation,
  runOperationStage,
} from '@core/services/operations/node';
import type { MementosRuntimeClient } from '@core/services/runtime-broker/api/clients';

const SESSION_TIMEOUT_MS = 30_000;
const WORKSPACE_TIMEOUT_MS = 5 * 60_000;
const PURGE_TIMEOUT_MS = 30_000;

export const deleteTaskOperationContribution = {
  create: (dependencies: DeleteTaskOperationDependencies, runtime: OperationRuntime) => [
    createDeleteTaskOperationDefinition(dependencies, runtime),
  ],
};

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
      operation: LifecycleOperationParams,
      context: Awaited<ReturnType<typeof resolveLifecycleOperationContext>>
    ): Promise<LifecycleSessionTargets>;
    killAcp(
      db: AppDb,
      operation: LifecycleOperationParams,
      targets: LifecycleSessionTargets
    ): Promise<void>;
    killTerminals(
      db: AppDb,
      operation: LifecycleOperationParams,
      context: Awaited<ReturnType<typeof resolveLifecycleOperationContext>>,
      targets: LifecycleSessionTargets
    ): Promise<void>;
  };
  telemetry: Pick<TelemetryService, 'capture'>;
  unregisterFileSearchRoot(path: HostAbsolutePath, host: HostRef): Promise<void> | void;
};

type OperationRuntime = { db: AppDb; clock: Clock; initiatedBy?: string };

type LifecycleSessionTargets = {
  acpConversationIds: string[];
  tuiConversationIds: string[];
  terminalSessionIds: string[];
  tmuxSessionNames: string[];
};

export function createDeleteTaskOperationDefinition(
  dependencies: DeleteTaskOperationDependencies,
  runtime: OperationRuntime
): OperationDefinition<typeof deleteTaskOperation> {
  const { sessionCleanup } = dependencies;
  const handler = createOperationHandler(deleteTaskOperation, async (ctx) => {
    const { input } = ctx;
    const operation = lifecycleParams(ctx.operationId, input, ctx.attempt, runtime.initiatedBy);
    if (input.source === 'reconciler' && !input.confirmedAt) {
      needsConfirmation(ctx, 'reconciler-proposed');
    }
    const context = await resolveLifecycleOperationContext(
      dependencies.lifecycleContext,
      runtime.db,
      operation,
      { resolveRuntimeConfig: true }
    );
    const [targets, otherTaskRows] = await Promise.all([
      sessionCleanup.resolve(runtime.db, operation, context),
      context.task?.workspaceId
        ? runtime.db
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
      input.deleteWorktree !== false &&
      !workspaceSharedWithLiveTasks &&
      (context.workspace?.kind === 'worktree' || context.workspace?.kind === 'byoi') &&
      !!context.workspace.path;

    if (context.task && isOperationStale(input, runtime.clock.now())) {
      needsConfirmation(ctx, 'stale');
    }
    if (
      context.task &&
      shouldTeardown &&
      isResumedOperation(input, ctx.attempt, runtime.clock.now()) &&
      !input.confirmedAt &&
      (await lifecycleWorkspaceIsDirty(dependencies.lifecycleCleanup, operation, context))
    ) {
      needsConfirmation(ctx, 'workspace-modified');
    }

    if (targets.acpConversationIds.length > 0) {
      await runOperationStage(ctx, {
        id: 'kill-acp-sessions',
        timeoutMs: SESSION_TIMEOUT_MS,
        clock: runtime.clock,
        run: async () => sessionCleanup.killAcp(runtime.db, operation, targets),
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
        run: async () => sessionCleanup.killTerminals(runtime.db, operation, context, targets),
      });
    }
    if (context.task && context.workspace?.path) {
      await runOperationStage(ctx, {
        id: 'deactivate-workspace',
        timeoutMs: WORKSPACE_TIMEOUT_MS,
        clock: runtime.clock,
        classifyError: classifyWorkspaceOperationError,
        run: async (signal, stage) =>
          deactivateLifecycleWorkspace(dependencies.lifecycleCleanup, operation, context, {
            signal,
            onWaitingChange: (waiting) => stage.progress(waiting ? 0.5 : 0),
          }),
      });
    }
    if (context.task && shouldTeardown) {
      await runOperationStage(ctx, {
        id: 'teardown-workspace',
        timeoutMs: WORKSPACE_TIMEOUT_MS,
        clock: runtime.clock,
        classifyError: classifyWorkspaceOperationError,
        run: async () =>
          teardownLifecycleWorkspace(dependencies.lifecycleCleanup, runtime.db, operation, context),
      });
    }
    if (context.task) {
      await runOperationStage(ctx, {
        id: 'purge-task-rows',
        timeoutMs: PURGE_TIMEOUT_MS,
        clock: runtime.clock,
        run: async () => purgeTaskRows(runtime.db, operation, context, dependencies),
      });
    }
    return { ok: true as const };
  });

  return {
    definition: deleteTaskOperation,
    handler,
    entityKind: 'task',
    examples: [
      {
        definition: deleteTaskOperation,
        input: {
          version: '1',
          source: 'user',
          taskId: 'task-example',
          projectId: 'project-example',
          workspaceId: 'workspace-example',
          hostRef: 'local',
          projectPath: '/repo',
          workspacePath: '/repo/.worktrees/task-example',
          branchName: 'task-example',
          deleteWorktree: true,
          deleteBranch: false,
          workspaceShared: false,
          createdAt: 1,
        },
      },
    ],
    describe: (input) => ({
      entityName: input.entityName,
      workspacePath: input.workspacePath,
      branchName: input.branchName,
      hostLabel: input.hostLabel,
    }),
    projectId: (input) => input.projectId,
    hostRef: (input) => input.hostRef,
    confirmedInput: (input, confirmedAt) => confirmInput(input, confirmedAt),
    purge: async ({ input, db }) => {
      db.transaction((tx) => {
        tx.delete(tasks).where(eq(tasks.id, input.taskId)).run();
      });
      await purgeTaskLocalState({ projectId: input.projectId, taskId: input.taskId }, dependencies);
    },
    reconcile: (context) => reconcileTaskCleanups(context),
  };
}

export async function enqueueDeleteTask(operations: OperationsEngineLike, input: DeleteTaskInput) {
  const createdAt = Date.now();
  const [task] = await operations.db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, input.taskId), isNull(tasks.deletedAt)))
    .limit(1);
  if (!task) {
    return err({ type: 'task-not-found', message: `Task ${input.taskId} was not found` });
  }
  const projectId = task.projectId;
  const [workspace] = task.workspaceId
    ? await operations.db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, task.workspaceId))
        .limit(1)
    : [];
  const [project] = await operations.db
    .select()
    .from(projects)
    .where(eq(projects.id, task.projectId))
    .limit(1);
  const otherTaskRows = task.workspaceId
    ? await operations.db
        .select({ id: tasks.id })
        .from(tasks)
        .where(
          and(
            eq(tasks.workspaceId, task.workspaceId),
            ne(tasks.id, task.id),
            isNull(tasks.deletedAt)
          )
        )
        .limit(1)
    : [];
  const hostRef = workspace?.sshConnectionId ?? project?.sshConnectionId ?? 'local';
  const operationInput: DeleteTaskOperationInput = {
    version: '1',
    source: 'user',
    taskId: task.id,
    projectId: task.projectId,
    workspaceId: task.workspaceId,
    hostRef,
    entityName: task.name,
    hostLabel: project?.sshConnectionId ? project.name : undefined,
    projectPath: project?.path,
    workspacePath: workspace?.path ?? undefined,
    branchName: workspace?.branchName ?? undefined,
    deleteWorktree: input.deleteWorktree ?? true,
    deleteBranch: input.deleteBranch ?? false,
    workspaceShared: otherTaskRows.length > 0,
    createdAt,
  };
  const result = await operations.submitWithTombstone(deleteTaskOperation, operationInput, {
    precondition: (tx) => projectIsActive(tx, task.projectId),
    tombstone: (tx) =>
      tx
        .update(tasks)
        .set({ deletedAt: new Date(createdAt).toISOString() })
        .where(and(eq(tasks.id, task.id), isNull(tasks.deletedAt)))
        .run().changes,
    revertTombstone: (tx) => {
      tx.update(tasks).set({ deletedAt: null }).where(eq(tasks.id, task.id)).run();
    },
  });
  if (result.success) appDbPokes.tasks.poke({ projectId, taskId: input.taskId });
  return result;
}

type OperationsEngineLike = {
  db: AppDb;
  submitWithTombstone<D extends typeof deleteTaskOperation>(
    definition: D,
    input: DeleteTaskOperationInput,
    options?: OperationSubmitOptions
  ): Promise<Result<{ operationId?: string }, { type: string; message: string }>>;
};

function projectIsActive(tx: DrizzleTx, projectId: string) {
  const active =
    tx
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .limit(1)
      .get() !== undefined;
  return active
    ? undefined
    : {
        type: 'project-deleting',
        message: 'Project is being deleted.',
      };
}

async function reconcileTaskCleanups(context: OperationReconcileContext): Promise<void> {
  const rows = await context.db.select().from(tasks).where(isNotNull(tasks.deletedAt));
  for (const task of rows) {
    if (
      await context.hasActiveKey(
        deleteTaskOperation.key({ ...exampleTaskInput(task.id), projectId: task.projectId })
      )
    ) {
      continue;
    }
    const [workspace] = task.workspaceId
      ? await context.db
          .select()
          .from(workspaces)
          .where(eq(workspaces.id, task.workspaceId))
          .limit(1)
      : [];
    const [project] = await context.db
      .select()
      .from(projects)
      .where(eq(projects.id, task.projectId))
      .limit(1);
    await context.submit(deleteTaskOperation, {
      version: '1',
      source: 'reconciler',
      taskId: task.id,
      projectId: task.projectId,
      workspaceId: task.workspaceId,
      hostRef: workspace?.sshConnectionId ?? project?.sshConnectionId ?? 'local',
      entityName: task.name,
      hostLabel: project?.name,
      projectPath: project?.path,
      workspacePath: workspace?.path ?? undefined,
      branchName: workspace?.branchName ?? undefined,
      deleteWorktree: true,
      deleteBranch: false,
      workspaceShared: false,
      createdAt: context.clock.now(),
    });
  }
}

function lifecycleParams(
  operationId: string,
  input: DeleteTaskOperationInput,
  attempt: number,
  initiatedBy?: string
): LifecycleOperationParams {
  return {
    operationId,
    kind: 'delete-task',
    projectId: input.projectId,
    taskId: input.taskId,
    workspaceId: input.workspaceId ?? null,
    entityKey: input.taskId,
    hostRef: input.hostRef,
    payload: {
      version: '2',
      source: input.source,
      entityName: input.entityName,
      hostLabel: input.hostLabel,
      workspacePath: input.workspacePath,
      branchName: input.branchName,
      deleteWorktree: input.deleteWorktree,
      deleteBranch: input.deleteBranch,
    },
    confirmedAt: input.confirmedAt ?? null,
    createdAt: input.createdAt,
    initiatedBy: initiatedBy ?? null,
    attempt,
  };
}

async function purgeTaskRows(
  db: AppDb,
  operation: LifecycleOperationParams,
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
    const workspace = hostFileRefFromNativePath(
      context.workspacePath,
      operation.hostRef === 'local' ? undefined : operation.hostRef
    );
    await dependencies.unregisterFileSearchRoot(workspace.path, workspace.host);
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

function exampleTaskInput(taskId: string): DeleteTaskOperationInput {
  return {
    version: '1',
    source: 'reconciler',
    taskId,
    projectId: 'project-example',
    hostRef: 'local',
    deleteWorktree: true,
    deleteBranch: false,
    workspaceShared: false,
    createdAt: 1,
  };
}
