import { err, ok } from '@emdash/shared';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
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
import {
  nonTerminalOperationStatuses,
  type OperationPayload,
} from '@core/primitives/operations/api';
import type { AppDb, DrizzleTx } from '@core/services/app-db/node/db';
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
  operationFailed,
  operationNeedsConfirmation,
  runOperationActions,
  type OperationAction,
  type OperationDefinition,
  type OperationSubmit,
  type OperationsEngine,
} from '@core/services/operations/node';

const SESSION_TIMEOUT_MS = 30_000;
const WORKSPACE_TIMEOUT_MS = 5 * 60_000;
const PURGE_TIMEOUT_MS = 30_000;
const UNKNOWN_BRANCH_SENTINEL = 'HEAD';
const reconcilerDedupeStatuses = [...nonTerminalOperationStatuses, 'abandoned'] as const;

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

export type WorkspaceLifecycleDependencies = {
  cleanup: LifecycleCleanupDependencies;
  lifecycleContext: LifecycleOperationContextDependencies;
  sessions: {
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
};

export function createDeleteWorkspaceOperationDefinition(
  dependencies: WorkspaceLifecycleDependencies
): OperationDefinition {
  return {
    kind: 'delete-workspace',
    entityKind: 'workspace',
    describe: (input) => describeWorkspaceOperation(dependencies, input),
    async run(runContext) {
      const { operation, db, clock } = runContext;
      const context = await resolveLifecycleOperationContext(
        dependencies.lifecycleContext,
        db,
        operation,
        { resolveRuntimeConfig: true }
      );
      const workspaceId = operation.workspaceId ?? context.workspace?.id;
      if (workspaceId && !(await lifecycleWorkspaceIsUnused(db, workspaceId))) {
        return operationFailed('Workspace is still referenced by an active task.', {
          code: 'workspace-in-use',
          retryable: false,
        });
      }
      const targets = await dependencies.sessions.resolve(db, operation, context);
      if (isOperationStale(operation, clock.now())) {
        return operationNeedsConfirmation('stale');
      }
      if (
        isResumedOperation(operation, clock.now()) &&
        !operation.payload.confirmedAt &&
        (await lifecycleWorkspaceIsDirty(dependencies.cleanup, operation, context))
      ) {
        return operationNeedsConfirmation('workspace-modified');
      }

      const actions: OperationAction[] = [];
      addSessionActions(dependencies, actions, runContext, context, targets);
      actions.push(
        {
          id: 'teardown-workspace',
          timeoutMs: WORKSPACE_TIMEOUT_MS,
          run: async () => teardownLifecycleWorkspace(dependencies.cleanup, db, operation, context),
        },
        {
          id: 'purge-workspace-row',
          timeoutMs: PURGE_TIMEOUT_MS,
          run: async () => purgeLifecycleWorkspaceRow(dependencies.cleanup, db, operation, context),
        }
      );
      return runOperationActions(runContext, actions);
    },
    async forget({ operation, db, markAbandoned }) {
      db.transaction((tx) => {
        markAbandoned(tx);
        if (operation.workspaceId) {
          tx.delete(workspaces).where(eq(workspaces.id, operation.workspaceId)).run();
        }
      });
    },
  };
}

export function createArchiveWorkspaceOperationDefinition(
  dependencies: WorkspaceLifecycleDependencies
): OperationDefinition {
  return {
    kind: 'archive-workspace',
    entityKind: 'workspace',
    describe: (input) => describeWorkspaceOperation(dependencies, input),
    async run(runContext) {
      const { operation, db, clock } = runContext;
      const context = await resolveLifecycleOperationContext(
        dependencies.lifecycleContext,
        db,
        operation,
        { resolveRuntimeConfig: true }
      );
      const targets = await dependencies.sessions.resolve(db, operation, context);
      if (isOperationStale(operation, clock.now())) {
        return operationNeedsConfirmation('stale');
      }
      if (
        context.workspacePath &&
        isResumedOperation(operation, clock.now()) &&
        !operation.payload.confirmedAt &&
        (await lifecycleWorkspaceIsDirty(dependencies.cleanup, operation, context))
      ) {
        return operationNeedsConfirmation('workspace-modified');
      }

      const actions: OperationAction[] = [];
      addSessionActions(dependencies, actions, runContext, context, targets);
      if (context.workspacePath) {
        actions.push(
          {
            id: 'deactivate-workspace',
            timeoutMs: WORKSPACE_TIMEOUT_MS,
            run: async () => deactivateLifecycleWorkspace(dependencies.cleanup, operation, context),
          },
          {
            id: 'clean-artifacts',
            timeoutMs: WORKSPACE_TIMEOUT_MS,
            run: async () =>
              cleanLifecycleWorkspaceArtifacts(dependencies.cleanup, operation, context),
          }
        );
      }
      actions.push({
        id: 'purge-workspace-row',
        timeoutMs: PURGE_TIMEOUT_MS,
        run: async () => purgeLifecycleWorkspaceRow(dependencies.cleanup, db, operation, context),
      });
      return runOperationActions(runContext, actions);
    },
  };
}

export async function enqueueDeleteWorkspace(operations: OperationsEngine, workspaceId: string) {
  return operations.submit(async ({ db, clock }) => {
    const [workspace] = await db
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)))
      .limit(1);
    if (!workspace) {
      const existing = await findWorkspaceOperation(db, workspaceId, nonTerminalOperationStatuses);
      return existing
        ? ok({ outcome: 'existing' as const, operationId: existing.id })
        : err({
            type: 'workspace-not-found',
            message: `Workspace ${workspaceId} was not found`,
          });
    }
    const [task] = await db.select().from(tasks).where(eq(tasks.workspaceId, workspaceId)).limit(1);
    const [project] = task
      ? await db.select().from(projects).where(eq(projects.id, task.projectId)).limit(1)
      : [];
    const createdAt = clock.now();
    return ok({
      outcome: 'enqueue' as const,
      draft: {
        kind: 'delete-workspace' as const,
        projectId: project?.id,
        taskId: task?.id,
        workspaceId,
        entityKey: workspaceId,
        hostRef: workspace.sshConnectionId ?? project?.sshConnectionId ?? 'local',
        payload: {
          version: '1' as const,
          source: 'user' as const,
          entityName: workspace.path ?? undefined,
          deleteWorktree: true,
          deleteBranch: false,
        },
        createdAt,
      },
      options: {
        dedupeStatuses: nonTerminalOperationStatuses,
        precondition: (tx: DrizzleTx) =>
          workspaceHasLiveTaskInTransaction(tx, workspaceId)
            ? {
                type: 'workspace-in-use',
                message: 'Workspace is still referenced by an active task.',
              }
            : undefined,
        tombstone: (tx: DrizzleTx) =>
          tx
            .update(workspaces)
            .set({ deletedAt: new Date(createdAt).toISOString() })
            .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)))
            .run().changes,
      },
    });
  });
}

export async function enqueueDeleteWorkspacePath(
  operations: OperationsEngine,
  input: ArchiveWorkspaceInput
) {
  return operations.submit(async ({ db, clock }) => {
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);
    if (!project) {
      return err({
        type: 'project-not-found',
        message: `Project ${input.projectId} was not found`,
      });
    }
    const entityKey = input.workspaceId ?? `workspace-path:${input.workspacePath}`;
    const createdAt = clock.now();
    return ok({
      outcome: 'enqueue' as const,
      draft: {
        kind: 'delete-workspace' as const,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        entityKey,
        hostRef: project.sshConnectionId ?? 'local',
        payload: {
          version: '1' as const,
          source: 'user' as const,
          entityName: input.workspacePath,
          workspacePath: input.workspacePath,
          branchName: input.branchName ?? UNKNOWN_BRANCH_SENTINEL,
          hostLabel: project.name,
          deleteWorktree: true,
          deleteBranch: false,
        },
        createdAt,
      },
      options: {
        dedupeStatuses: nonTerminalOperationStatuses,
        precondition: input.workspaceId
          ? (tx: DrizzleTx) =>
              workspaceHasLiveTaskInTransaction(tx, input.workspaceId!)
                ? {
                    type: 'workspace-in-use',
                    message: 'Workspace is still referenced by an active task.',
                  }
                : undefined
          : undefined,
        tombstone: input.workspaceId
          ? (tx: DrizzleTx) =>
              tx
                .update(workspaces)
                .set({ deletedAt: new Date(createdAt).toISOString() })
                .where(and(eq(workspaces.id, input.workspaceId!), isNull(workspaces.deletedAt)))
                .run().changes
          : undefined,
      },
    });
  });
}

export async function enqueueArchiveWorkspace(
  operations: OperationsEngine,
  input: ArchiveWorkspaceInput
) {
  return operations.submit(async ({ db }) => {
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, input.projectId), isNull(projects.deletedAt)))
      .limit(1);
    if (!project) {
      return err({
        type: 'project-not-found',
        message: `Project ${input.projectId} was not found`,
      });
    }
    const [workspace] = input.workspaceId
      ? await db
          .select()
          .from(workspaces)
          .where(and(eq(workspaces.id, input.workspaceId), isNull(workspaces.deletedAt)))
          .limit(1)
      : [];
    if (input.workspaceId && !workspace) {
      return err({
        type: 'workspace-not-found',
        message: `Workspace ${input.workspaceId} was not found`,
      });
    }
    const entityKey = input.workspaceId ?? `workspace-path:${input.workspacePath}`;
    return ok({
      outcome: 'enqueue' as const,
      draft: {
        kind: 'archive-workspace' as const,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        entityKey,
        hostRef: workspace?.sshConnectionId ?? project.sshConnectionId ?? 'local',
        payload: {
          version: '1' as const,
          source: 'user' as const,
          entityName: input.workspacePath,
          workspacePath: input.workspacePath,
          branchName: input.branchName,
          hostLabel: project.name,
        },
      },
      options: { dedupeStatuses: nonTerminalOperationStatuses },
    });
  });
}

export async function submitReconcilerWorkspaceCleanup(
  submit: OperationSubmit,
  input: ArchiveWorkspaceInput
): Promise<void> {
  await submit(async ({ db, clock }) => {
    const entityKey = input.workspaceId ?? `workspace-path:${input.workspacePath}`;
    const existing = await findWorkspaceOperation(db, entityKey, reconcilerDedupeStatuses);
    if (existing) return ok({ outcome: 'existing' as const, operationId: existing.id });
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);
    if (!project) return ok({ outcome: 'existing' as const });
    const createdAt = clock.now();
    const payload: OperationPayload = {
      version: '1',
      source: 'reconciler',
      entityName: input.workspacePath,
      workspacePath: input.workspacePath,
      branchName: input.branchName ?? UNKNOWN_BRANCH_SENTINEL,
      hostLabel: project.name,
      deleteWorktree: true,
      deleteBranch: false,
      confirmationReason: 'reconciler-proposed',
    };
    return ok({
      outcome: 'enqueue' as const,
      draft: {
        kind: 'delete-workspace' as const,
        status: 'awaiting-confirmation' as const,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        entityKey,
        hostRef: project.sshConnectionId ?? 'local',
        payload,
        createdAt,
      },
      options: {
        dedupeStatuses: reconcilerDedupeStatuses,
        tombstone: input.workspaceId
          ? (tx: DrizzleTx) => {
              tx.update(workspaces)
                .set({ deletedAt: new Date(createdAt).toISOString() })
                .where(eq(workspaces.id, input.workspaceId!))
                .run();
              return 1;
            }
          : undefined,
      },
    });
  });
}

async function describeWorkspaceOperation(
  dependencies: WorkspaceLifecycleDependencies,
  { operation, db }: Parameters<OperationDefinition['describe']>[0]
) {
  const context = await resolveLifecycleOperationContext(
    dependencies.lifecycleContext,
    db,
    operation
  );
  return {
    entityName: context.workspacePath ?? context.project?.name,
    workspacePath: context.workspacePath,
    branchName: context.branchName,
  };
}

function addSessionActions(
  dependencies: WorkspaceLifecycleDependencies,
  actions: Parameters<typeof runOperationActions>[1],
  runContext: Parameters<OperationDefinition['run']>[0],
  context: Awaited<ReturnType<typeof resolveLifecycleOperationContext>>,
  targets: LifecycleSessionTargets
): void {
  const { operation, db } = runContext;
  if (targets.acpConversationIds.length > 0) {
    actions.push({
      id: 'kill-acp-sessions',
      timeoutMs: SESSION_TIMEOUT_MS,
      run: async () => dependencies.sessions.killAcp(db, operation, targets),
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
      run: async () => dependencies.sessions.killTerminals(db, operation, context, targets),
    });
  }
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

async function findWorkspaceOperation(
  db: Parameters<OperationDefinition['run']>[0]['db'],
  entityId: string,
  statuses: readonly (typeof lifecycleOperations.$inferSelect.status)[]
) {
  const [operation] = await db
    .select()
    .from(lifecycleOperations)
    .where(
      and(
        eq(lifecycleOperations.entityKey, entityId),
        inArray(lifecycleOperations.kind, ['delete-workspace', 'archive-workspace']),
        inArray(lifecycleOperations.status, [...statuses])
      )
    )
    .orderBy(desc(lifecycleOperations.createdAt))
    .limit(1);
  return operation;
}
