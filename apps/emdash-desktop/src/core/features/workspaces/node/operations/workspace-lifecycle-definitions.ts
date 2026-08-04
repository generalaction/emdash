import {
  createOperationHandler,
  defineOperation,
  type InputOf,
} from '@emdash/core/primitives/kernel/api';
import { defineVersionedSchema } from '@emdash/core/primitives/versioned-schema/api';
import { err, type Result } from '@emdash/shared';
import type { Clock } from '@emdash/shared/scheduling';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import z from 'zod';
import { classifyWorkspaceOperationError } from '@core/features/workspaces/api/node/operation-error-classifier';
import {
  cleanLifecycleWorkspaceArtifacts,
  deactivateLifecycleWorkspace,
  lifecycleWorkspaceIsDirty,
  lifecycleWorkspaceIsUnused,
  purgeLifecycleWorkspaceRow,
  teardownLifecycleWorkspace,
  type LifecycleCleanupDependencies,
} from '@core/features/workspaces/api/node/operations/lifecycle-cleanup';
import { resolveLifecycleOperationContext } from '@core/features/workspaces/api/node/operations/lifecycle-operation-context';
import type { LifecycleOperationContextDependencies } from '@core/features/workspaces/api/node/operations/lifecycle-operation-context';
import { workspaceKernelClaims } from '@core/primitives/operations/api/resources';
import type { AppDb, DrizzleTx } from '@core/services/app-db/node/db';
import { projects, tasks, workspaces } from '@core/services/app-db/node/schema';
import type {
  LifecycleOperationParams,
  OperationDefinition,
  OperationReconcileContext,
  OperationSubmitOptions,
} from '@core/services/operations/node';
import {
  confirmInput,
  failOperation,
  isOperationStale,
  isResumedOperation,
  needsConfirmation,
  operationErrorSchema,
  operationResultSchema,
  operationRetryPolicy,
  runOperationStage,
} from '@core/services/operations/node';

const SESSION_TIMEOUT_MS = 30_000;
const WORKSPACE_TIMEOUT_MS = 5 * 60_000;
const PURGE_TIMEOUT_MS = 30_000;

const workspaceOperationInputSchema = defineVersionedSchema()
  .initial(
    '1',
    z.object({
      version: z.literal('1'),
      source: z.enum(['user', 'reconciler']),
      projectId: z.string().optional(),
      taskId: z.string().optional(),
      workspaceId: z.string().optional(),
      entityKey: z.string(),
      hostRef: z.string(),
      entityName: z.string().optional(),
      hostLabel: z.string().optional(),
      projectPath: z.string().optional(),
      workspacePath: z.string().optional(),
      branchName: z.string().optional(),
      deleteWorktree: z.boolean().optional(),
      deleteBranch: z.boolean().optional(),
      confirmedAt: z.number().int().nonnegative().optional(),
      createdAt: z.number().int().nonnegative(),
    })
  )
  .build();

export type WorkspaceOperationInput = typeof workspaceOperationInputSchema.Type;

export const deleteWorkspaceOperation = defineOperation({
  name: 'delete-workspace',
  input: workspaceOperationInputSchema,
  result: operationResultSchema,
  error: operationErrorSchema,
  key: (input) => `workspace:${input.entityKey}`,
  claims: (input) =>
    workspaceKernelClaims({
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      branch:
        input.projectId && input.branchName
          ? { projectId: input.projectId, branchName: input.branchName }
          : undefined,
      worktree:
        input.projectPath && input.workspacePath
          ? {
              hostRef: input.hostRef,
              repoPath: input.projectPath,
              worktreePath: input.workspacePath,
            }
          : undefined,
    }),
  describe: (input) => input.entityName ?? input.workspacePath ?? input.entityKey,
  retry: operationRetryPolicy,
});

export const archiveWorkspaceOperation = defineOperation({
  name: 'archive-workspace',
  input: workspaceOperationInputSchema,
  result: operationResultSchema,
  error: operationErrorSchema,
  key: (input) => `archive-workspace:${input.entityKey}`,
  claims: deleteWorkspaceOperation.claims,
  describe: deleteWorkspaceOperation.describe,
  retry: operationRetryPolicy,
});

export const deleteWorkspaceOperationContribution = {
  create: (dependencies: WorkspaceLifecycleDependencies, runtime: OperationRuntime) => [
    createDeleteWorkspaceOperationDefinition(dependencies, runtime),
  ],
};

export const archiveWorkspaceOperationContribution = {
  create: (dependencies: WorkspaceLifecycleDependencies, runtime: OperationRuntime) => [
    createArchiveWorkspaceOperationDefinition(dependencies, runtime),
  ],
};

export type ArchiveWorkspaceInput = {
  projectId: string;
  workspaceId?: string;
  workspacePath: string;
  branchName?: string;
};

type LifecycleSessionTargets = {
  acpConversationIds: string[];
  tuiConversationIds: string[];
  terminalSessionIds: string[];
  tmuxSessionNames: string[];
};

type OperationRuntime = { db: AppDb; clock: Clock; initiatedBy?: string };

export type WorkspaceLifecycleDependencies = {
  cleanup: LifecycleCleanupDependencies;
  lifecycleContext: LifecycleOperationContextDependencies;
  sessions: {
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
};

export function createDeleteWorkspaceOperationDefinition(
  dependencies: WorkspaceLifecycleDependencies,
  runtime: OperationRuntime
): OperationDefinition<typeof deleteWorkspaceOperation> {
  const handler = createOperationHandler(deleteWorkspaceOperation, async (ctx) => {
    const operation = lifecycleParams(
      'delete-workspace',
      ctx.operationId,
      ctx.input,
      ctx.attempt,
      runtime.initiatedBy
    );
    if (ctx.input.source === 'reconciler' && !ctx.input.confirmedAt) {
      needsConfirmation(ctx, 'reconciler-proposed');
    }
    const context = await resolveLifecycleOperationContext(
      dependencies.lifecycleContext,
      runtime.db,
      operation,
      {
        resolveRuntimeConfig: true,
      }
    );
    const workspaceId = ctx.input.workspaceId ?? context.workspace?.id;
    if (workspaceId && !(await lifecycleWorkspaceIsUnused(runtime.db, workspaceId))) {
      failOperation(ctx, 'Workspace is still referenced by an active task.', {
        code: 'workspace-in-use',
        retryable: false,
      });
    }
    const targets = await dependencies.sessions.resolve(runtime.db, operation, context);
    await confirmDirtyWorkspaceIfNeeded(ctx, dependencies, operation, context, runtime.clock);
    await runSessionStages(ctx, dependencies, runtime, operation, context, targets);
    await runOperationStage(ctx, {
      id: 'teardown-workspace',
      timeoutMs: WORKSPACE_TIMEOUT_MS,
      clock: runtime.clock,
      classifyError: classifyWorkspaceOperationError,
      run: async () =>
        teardownLifecycleWorkspace(dependencies.cleanup, runtime.db, operation, context),
    });
    await runOperationStage(ctx, {
      id: 'purge-workspace-row',
      timeoutMs: PURGE_TIMEOUT_MS,
      clock: runtime.clock,
      run: async () =>
        purgeLifecycleWorkspaceRow(dependencies.cleanup, runtime.db, operation, context),
    });
    return { ok: true as const };
  });
  return workspaceDescriptor(deleteWorkspaceOperation, handler, 'workspace', {
    reconcile: (context) => reconcileWorkspaceCleanups(context),
  });
}

export function createArchiveWorkspaceOperationDefinition(
  dependencies: WorkspaceLifecycleDependencies,
  runtime: OperationRuntime
): OperationDefinition<typeof archiveWorkspaceOperation> {
  const handler = createOperationHandler(archiveWorkspaceOperation, async (ctx) => {
    const operation = lifecycleParams(
      'archive-workspace',
      ctx.operationId,
      ctx.input,
      ctx.attempt,
      runtime.initiatedBy
    );
    const context = await resolveLifecycleOperationContext(
      dependencies.lifecycleContext,
      runtime.db,
      operation,
      {
        resolveRuntimeConfig: true,
      }
    );
    const targets = await dependencies.sessions.resolve(runtime.db, operation, context);
    await confirmDirtyWorkspaceIfNeeded(ctx, dependencies, operation, context, runtime.clock);
    await runSessionStages(ctx, dependencies, runtime, operation, context, targets);
    if (context.workspacePath) {
      await runOperationStage(ctx, {
        id: 'deactivate-workspace',
        timeoutMs: WORKSPACE_TIMEOUT_MS,
        clock: runtime.clock,
        classifyError: classifyWorkspaceOperationError,
        run: async (signal, stage) =>
          deactivateLifecycleWorkspace(dependencies.cleanup, operation, context, {
            signal,
            onWaitingChange: (waiting) => stage.progress(waiting ? 0.5 : 0),
          }),
      });
      await runOperationStage(ctx, {
        id: 'clean-artifacts',
        timeoutMs: WORKSPACE_TIMEOUT_MS,
        clock: runtime.clock,
        classifyError: classifyWorkspaceOperationError,
        run: async (signal, stage) =>
          cleanLifecycleWorkspaceArtifacts(dependencies.cleanup, operation, context, {
            signal,
            onWaitingChange: (waiting) => stage.progress(waiting ? 0.5 : 0),
          }),
      });
    }
    await runOperationStage(ctx, {
      id: 'purge-workspace-row',
      timeoutMs: PURGE_TIMEOUT_MS,
      clock: runtime.clock,
      run: async () =>
        purgeLifecycleWorkspaceRow(dependencies.cleanup, runtime.db, operation, context),
    });
    return { ok: true as const };
  });
  return workspaceDescriptor(archiveWorkspaceOperation, handler, 'workspace');
}

export async function enqueueDeleteWorkspace(
  operations: OperationsEngineLike,
  workspaceId: string
) {
  const [workspace] = await operations.db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.untrackedAt)))
    .limit(1);
  if (!workspace) {
    return err({ type: 'workspace-not-found', message: `Workspace ${workspaceId} was not found` });
  }
  const [task] = await operations.db
    .select()
    .from(tasks)
    .where(eq(tasks.workspaceId, workspaceId))
    .limit(1);
  const [project] = task
    ? await operations.db.select().from(projects).where(eq(projects.id, task.projectId)).limit(1)
    : [];
  const createdAt = Date.now();
  const input = workspaceInput({
    projectId: project?.id,
    taskId: task?.id,
    workspaceId,
    entityKey: workspaceId,
    hostRef: workspace.sshConnectionId ?? project?.sshConnectionId ?? 'local',
    entityName: workspace.path ?? undefined,
    hostLabel: project?.name,
    projectPath: project?.path,
    workspacePath: workspace.path ?? undefined,
    branchName: workspace.branchName ?? undefined,
    deleteWorktree: true,
    deleteBranch: false,
    createdAt,
  });
  return operations.submitWithTombstone(deleteWorkspaceOperation, input, {
    precondition: (tx) =>
      workspacePrecondition(tx, { projectId: project?.id, workspaceId, requireUnused: true }),
    tombstone: (tx) =>
      tx
        .update(workspaces)
        .set({ untrackedAt: new Date(createdAt).toISOString() })
        .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.untrackedAt)))
        .run().changes,
    revertTombstone: (tx) => {
      tx.update(workspaces).set({ untrackedAt: null }).where(eq(workspaces.id, workspaceId)).run();
    },
  });
}

export async function enqueueDeleteWorkspacePath(
  operations: OperationsEngineLike,
  input: ArchiveWorkspaceInput
) {
  return enqueueWorkspacePathOperation(operations, deleteWorkspaceOperation, input, true);
}

export async function enqueueArchiveWorkspace(
  operations: OperationsEngineLike,
  input: ArchiveWorkspaceInput
) {
  return enqueueWorkspacePathOperation(operations, archiveWorkspaceOperation, input, false);
}

export async function submitReconcilerWorkspaceCleanup(
  context: OperationReconcileContext,
  input: ArchiveWorkspaceInput
): Promise<void> {
  const entityKey = input.workspaceId ?? `workspace-path:${input.workspacePath}`;
  if (await context.hasActiveKey(deleteWorkspaceOperation.key(exampleWorkspaceInput(entityKey)))) {
    return;
  }
  const [project] = await context.db
    .select()
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1);
  await context.submit(
    deleteWorkspaceOperation,
    workspaceInput({
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      entityKey,
      hostRef: project?.sshConnectionId ?? 'local',
      entityName: input.workspacePath,
      hostLabel: project?.name,
      projectPath: project?.path,
      workspacePath: input.workspacePath,
      branchName: input.branchName,
      deleteWorktree: true,
      deleteBranch: false,
      source: 'reconciler',
      createdAt: context.clock.now(),
    })
  );
}

async function enqueueWorkspacePathOperation<
  D extends typeof deleteWorkspaceOperation | typeof archiveWorkspaceOperation,
>(
  operations: OperationsEngineLike,
  definition: D,
  input: ArchiveWorkspaceInput,
  tombstoneWorkspace: boolean
) {
  const [project] = await operations.db
    .select()
    .from(projects)
    .where(and(eq(projects.id, input.projectId), isNull(projects.deletedAt)))
    .limit(1);
  if (!project) {
    return err({ type: 'project-not-found', message: `Project ${input.projectId} was not found` });
  }
  const [workspace] = input.workspaceId
    ? await operations.db
        .select()
        .from(workspaces)
        .where(and(eq(workspaces.id, input.workspaceId), isNull(workspaces.untrackedAt)))
        .limit(1)
    : [];
  if (input.workspaceId && !workspace) {
    return err({
      type: 'workspace-not-found',
      message: `Workspace ${input.workspaceId} was not found`,
    });
  }
  const createdAt = Date.now();
  const entityKey = input.workspaceId ?? `workspace-path:${input.workspacePath}`;
  const opInput = workspaceInput({
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    entityKey,
    hostRef: workspace?.sshConnectionId ?? project.sshConnectionId ?? 'local',
    entityName: input.workspacePath,
    hostLabel: project.name,
    projectPath: project.path,
    workspacePath: input.workspacePath,
    branchName: input.branchName,
    deleteWorktree: definition.name === 'delete-workspace' ? true : undefined,
    deleteBranch: definition.name === 'delete-workspace' ? false : undefined,
    createdAt,
  });
  return operations.submitWithTombstone(definition, opInput as InputOf<D>, {
    precondition: (tx) =>
      workspacePrecondition(tx, {
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        requireUnused: tombstoneWorkspace && input.workspaceId !== undefined,
      }),
    tombstone:
      tombstoneWorkspace && input.workspaceId
        ? (tx) =>
            tx
              .update(workspaces)
              .set({ untrackedAt: new Date(createdAt).toISOString() })
              .where(and(eq(workspaces.id, input.workspaceId!), isNull(workspaces.untrackedAt)))
              .run().changes
        : undefined,
    revertTombstone:
      tombstoneWorkspace && input.workspaceId
        ? (tx) => {
            tx.update(workspaces)
              .set({ untrackedAt: null })
              .where(eq(workspaces.id, input.workspaceId!))
              .run();
          }
        : undefined,
  });
}

type OperationsEngineLike = {
  db: AppDb;
  submitWithTombstone<D extends typeof deleteWorkspaceOperation | typeof archiveWorkspaceOperation>(
    definition: D,
    input: InputOf<D>,
    options?: OperationSubmitOptions
  ): Promise<Result<{ operationId?: string }, { type: string; message: string }>>;
};

function workspaceDescriptor<
  D extends typeof deleteWorkspaceOperation | typeof archiveWorkspaceOperation,
>(
  definition: D,
  handler: ReturnType<typeof createOperationHandler<D>>,
  entityKind: 'workspace',
  hooks: Pick<OperationDefinition<D>, 'reconcile'> = {}
): OperationDefinition<D> {
  return {
    definition,
    handler,
    entityKind,
    examples: [
      {
        definition,
        input: workspaceInput({
          projectId: 'project-example',
          workspaceId: 'workspace-example',
          entityKey: 'workspace-example',
          hostRef: 'local',
          projectPath: '/repo',
          workspacePath: '/repo/.worktrees/workspace-example',
          branchName: 'workspace-example',
          createdAt: 1,
        }) as InputOf<D>,
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
      if (!input.workspaceId) return;
      db.transaction((tx) => {
        tx.delete(workspaces).where(eq(workspaces.id, input.workspaceId!)).run();
      });
    },
    ...hooks,
  };
}

async function confirmDirtyWorkspaceIfNeeded(
  ctx: Parameters<typeof createOperationHandler<typeof deleteWorkspaceOperation>>[1] extends (
    ctx: infer T
  ) => unknown
    ? T
    : never,
  dependencies: WorkspaceLifecycleDependencies,
  operation: LifecycleOperationParams,
  context: Awaited<ReturnType<typeof resolveLifecycleOperationContext>>,
  clock: Clock
): Promise<void> {
  if (isOperationStale(ctx.input, clock.now())) needsConfirmation(ctx, 'stale');
  if (
    context.workspacePath &&
    isResumedOperation(ctx.input, ctx.attempt, clock.now()) &&
    !ctx.input.confirmedAt &&
    (await lifecycleWorkspaceIsDirty(dependencies.cleanup, operation, context))
  ) {
    needsConfirmation(ctx, 'workspace-modified');
  }
}

async function runSessionStages(
  ctx: Parameters<typeof createOperationHandler<typeof deleteWorkspaceOperation>>[1] extends (
    ctx: infer T
  ) => unknown
    ? T
    : never,
  dependencies: WorkspaceLifecycleDependencies,
  runtime: OperationRuntime,
  operation: LifecycleOperationParams,
  context: Awaited<ReturnType<typeof resolveLifecycleOperationContext>>,
  targets: LifecycleSessionTargets
): Promise<void> {
  if (targets.acpConversationIds.length > 0) {
    await runOperationStage(ctx, {
      id: 'kill-acp-sessions',
      timeoutMs: SESSION_TIMEOUT_MS,
      clock: runtime.clock,
      run: async () => dependencies.sessions.killAcp(runtime.db, operation, targets),
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
      run: async () => dependencies.sessions.killTerminals(runtime.db, operation, context, targets),
    });
  }
}

async function reconcileWorkspaceCleanups(context: OperationReconcileContext): Promise<void> {
  const rows = await context.db.select().from(workspaces).where(isNotNull(workspaces.untrackedAt));
  for (const workspace of rows) {
    const entityKey = workspace.id;
    if (
      await context.hasActiveKey(deleteWorkspaceOperation.key(exampleWorkspaceInput(entityKey)))
    ) {
      continue;
    }
    const [task] = await context.db
      .select()
      .from(tasks)
      .where(eq(tasks.workspaceId, workspace.id))
      .limit(1);
    const [project] = task
      ? await context.db.select().from(projects).where(eq(projects.id, task.projectId)).limit(1)
      : [];
    if (!project) continue;
    await context.submit(
      deleteWorkspaceOperation,
      workspaceInput({
        projectId: project.id,
        taskId: task?.id,
        workspaceId: workspace.id,
        entityKey,
        hostRef: workspace.sshConnectionId ?? project.sshConnectionId ?? 'local',
        entityName: workspace.path ?? undefined,
        hostLabel: project.name,
        projectPath: project.path,
        workspacePath: workspace.path ?? undefined,
        branchName: workspace.branchName ?? undefined,
        deleteWorktree: true,
        deleteBranch: false,
        source: 'reconciler',
        createdAt: context.clock.now(),
      })
    );
  }
}

function workspaceInput(
  input: Omit<WorkspaceOperationInput, 'version' | 'source'> & { source?: 'user' | 'reconciler' }
): WorkspaceOperationInput {
  return { version: '1', source: input.source ?? 'user', ...input };
}

function exampleWorkspaceInput(entityKey: string): WorkspaceOperationInput {
  return workspaceInput({
    entityKey,
    hostRef: 'local',
    createdAt: 1,
  });
}

function lifecycleParams(
  kind: 'delete-workspace' | 'archive-workspace',
  operationId: string,
  input: WorkspaceOperationInput,
  attempt: number,
  initiatedBy?: string
): LifecycleOperationParams {
  return {
    operationId,
    kind,
    projectId: input.projectId ?? null,
    taskId: input.taskId ?? null,
    workspaceId: input.workspaceId ?? null,
    entityKey: input.entityKey,
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

function workspacePrecondition(
  tx: DrizzleTx,
  input: { projectId?: string; workspaceId?: string; requireUnused: boolean }
) {
  if (input.projectId && projectIsDeletedInTransaction(tx, input.projectId)) {
    return { type: 'project-deleting', message: 'Project is being deleted.' };
  }
  if (
    input.requireUnused &&
    input.workspaceId &&
    workspaceHasLiveTaskInTransaction(tx, input.workspaceId)
  ) {
    return {
      type: 'workspace-in-use',
      message: 'Workspace is still referenced by an active task.',
    };
  }
  return undefined;
}

function workspaceHasLiveTaskInTransaction(tx: DrizzleTx, workspaceId: string): boolean {
  return (
    tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.workspaceId, workspaceId), isNull(tasks.deletedAt)))
      .limit(1)
      .get() !== undefined
  );
}

function projectIsDeletedInTransaction(tx: DrizzleTx, projectId: string): boolean {
  return (
    tx
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .limit(1)
      .get() === undefined
  );
}
