import {
  formatHostRef,
  LOCAL_HOST_REF,
  parseHostRef,
  sshConnectionIdOf,
  type HostRef,
} from '@emdash/core/primitives/host/api';
import { createOperationHandler } from '@emdash/core/primitives/kernel/api';
import type { HostAbsolutePath } from '@emdash/core/primitives/path/api';
import type { Clock } from '@emdash/shared/scheduling';
import { and, eq, isNotNull, isNull, ne } from 'drizzle-orm';
import {
  hostDeleteConversationOperation,
  type HostDeleteConversationInput,
} from '@core/features/conversations/api/node/host-delete-conversation-operation';
import { compileConversationDeletionInput } from '@core/features/conversations/api/node/operations/conversation-removal';
import {
  createConversationRegistry,
  conversationRegistryTable as conversationRows,
  liveConversations,
} from '@core/features/conversations/api/node/registry';
import {
  deleteTaskOperation,
  deleteTaskOperationKey,
  type DeleteTaskOperationInput,
} from '@core/features/tasks/api/node/delete-task-operation';
import { taskSubject } from '@core/features/tasks/contributions/subject';
import { operationHostRef } from '@core/features/workspaces/api/node/operation-host-ref';
import { resolveLifecycleOperationContext } from '@core/features/workspaces/api/node/operations/lifecycle-operation-context';
import type { LifecycleOperationContextDependencies } from '@core/features/workspaces/api/node/operations/lifecycle-operation-context';
import {
  deleteWorkspaceThroughRegistry,
  type WorkspaceRemovalBroker,
} from '@core/features/workspaces/api/node/operations/workspace-removal';
import {
  createWorkspaceRegistry,
  workspaceRegistryTable as workspaces,
} from '@core/features/workspaces/api/node/registry';
import { getProvisionedWorkspaceBranch } from '@core/features/workspaces/api/node/workspace-branch';
import { hostFileRefFromNativePath } from '@core/primitives/desktop-runtime/api';
import type { TelemetryService } from '@core/primitives/telemetry/api/telemetry';
import type { AppDb, DrizzleTx } from '@core/services/app-db/node/db';
import { appDbPokes } from '@core/services/app-db/node/pokes';
import { projects, tasks } from '@core/services/app-db/node/schema';
import { enqueueTombstoned, type OperationSubmitter } from '@core/services/operations/api/node';
import type {
  LifecycleOperationParams,
  OperationDefinition,
  OperationReconcileContext,
} from '@core/services/operations/node';
import {
  needsConfirmation,
  rejectOperationOutcome,
  runOperationStage,
  stageOk,
} from '@core/services/operations/node';
import type { MementosRuntimeClient } from '@core/services/runtime-broker/api/clients';

const SESSION_TIMEOUT_MS = 30_000;
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
  /**
   * Explicit, declinable, default-on cascade (spec §7.2): delete the task's conversation
   * records on their host as per-record outbox requests enqueued alongside. Declining
   * unlinks the records instead — they orphan into the discovery surface.
   */
  deleteConversations?: boolean;
};

export type DeleteTaskOperationDependencies = {
  lifecycleContext: LifecycleOperationContextDependencies;
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

/**
 * Desktop-plane task deletion: tombstone confirmed at enqueue, this handler
 * kills the task's agent sessions (best effort — the host session GC reaps
 * anything unreachable) and purges desktop rows. Worktree removal runs
 * through the registry `deleteWorktree` verb before this is enqueued.
 */
export function createDeleteTaskOperationDefinition(
  dependencies: DeleteTaskOperationDependencies,
  runtime: OperationRuntime
): OperationDefinition<typeof deleteTaskOperation> {
  const { sessionCleanup } = dependencies;
  const handler = createOperationHandler(deleteTaskOperation, async (ctx) => {
    const { input } = ctx;
    const operation = lifecycleParams(ctx.operationId, input, ctx.attempt, runtime.initiatedBy);
    if (input.source === 'reconciler' && !input.confirmedAt) {
      rejectOperationOutcome(ctx, needsConfirmation('reconciler-proposed'));
    }
    const context = await resolveLifecycleOperationContext(
      dependencies.lifecycleContext,
      runtime.db,
      operation,
      { resolveRuntimeConfig: false }
    );

    await runOperationStage(ctx, {
      id: 'kill-sessions',
      timeoutMs: SESSION_TIMEOUT_MS,
      clock: runtime.clock,
      run: async () => {
        // Best effort: an unreachable host must not block desktop deletion.
        // The host reaps orphaned sessions when the worktree is removed.
        try {
          const targets = await sessionCleanup.resolve(runtime.db, operation, context);
          if (targets.acpConversationIds.length > 0) {
            await sessionCleanup.killAcp(runtime.db, operation, targets);
          }
          if (
            targets.tuiConversationIds.length > 0 ||
            targets.terminalSessionIds.length > 0 ||
            targets.tmuxSessionNames.length > 0
          ) {
            await sessionCleanup.killTerminals(runtime.db, operation, context, targets);
          }
        } catch {
          // Swallowed by design; see stage comment.
        }
        return stageOk();
      },
    });

    if (context.task) {
      await runOperationStage(ctx, {
        id: 'purge-task-rows',
        timeoutMs: PURGE_TIMEOUT_MS,
        clock: runtime.clock,
        run: async () => {
          await purgeTaskRows(runtime.db, operation, context, dependencies);
          return stageOk();
        },
      });
    }
    return { ok: true as const };
  });

  return {
    definition: deleteTaskOperation,
    handler,
    entityKind: 'task',
    displayName: 'Deleting task',
    keyForId: deleteTaskOperationKey,
    examples: [
      {
        definition: deleteTaskOperation,
        input: {
          version: '1',
          source: 'user',
          taskId: 'task-example',
          projectId: 'project-example',
          workspaceId: 'workspace-example',
          hostRef: formatHostRef(LOCAL_HOST_REF),
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
    purge: async ({ input, db }) => {
      db.transaction((tx) => {
        purgeUntrackedTaskConversationRows(db, input.taskId, tx);
        tx.delete(tasks).where(eq(tasks.id, input.taskId)).run();
      });
      await purgeTaskLocalState({ projectId: input.projectId, taskId: input.taskId }, dependencies);
    },
    reconcile: (context) => reconcileTaskCleanups(context),
  };
}

export async function enqueueDeleteTask(
  operations: OperationSubmitter,
  runtimes: WorkspaceRemovalBroker,
  input: DeleteTaskInput
) {
  const createdAt = Date.now();
  const deleteConversations = input.deleteConversations !== false;
  const conversationRegistry = createConversationRegistry(operations.db);
  let workspaceIdForRemoval: string | undefined;
  let workspaceShared = false;
  // Snapshot-compiled at enqueue time: the handler's task-row purge clears the tombstoned
  // client mirror rows, so per-record delete inputs must never be resolved later.
  let conversationDeletions: HostDeleteConversationInput[] = [];
  const result = await enqueueTombstoned(operations, {
    definition: deleteTaskOperation,
    load: async () => {
      const [task] = await operations.db
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, input.taskId), isNull(tasks.deletedAt)))
        .limit(1);
      if (!task) return undefined;
      const workspace = task.workspaceId
        ? createWorkspaceRegistry(operations.db).getLive(task.workspaceId)
        : undefined;
      const [project] = await operations.db
        .select({
          name: projects.name,
          repositoryPath: workspaces.path,
          repositoryLocation: workspaces.location,
          repositorySshConnectionId: workspaces.sshConnectionId,
        })
        .from(projects)
        .leftJoin(workspaces, eq(workspaces.id, projects.repositoryWorkspaceId))
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
      const taskConversations = await operations.db
        .select()
        .from(conversationRows)
        .where(and(eq(conversationRows.taskId, task.id), liveConversations()));
      workspaceIdForRemoval = task.workspaceId ?? undefined;
      workspaceShared = otherTaskRows.length > 0;
      conversationDeletions = deleteConversations
        ? taskConversations.map((row) => compileConversationDeletionInput(row, createdAt))
        : [];
      return { task, workspace, project, workspaceShared, taskConversations };
    },
    notFound: () => ({
      type: 'task-not-found',
      message: `Task ${input.taskId} was not found`,
    }),
    buildInput: ({ task, workspace, project, workspaceShared }): DeleteTaskOperationInput => ({
      version: '1',
      source: 'user',
      taskId: task.id,
      projectId: task.projectId,
      workspaceId: task.workspaceId,
      hostRef: formatHostRef(LOCAL_HOST_REF),
      targetHostRef: formatHostRef(
        operationHostRef({
          workspace,
          repository: project && {
            location: project.repositoryLocation,
            sshConnectionId: project.repositorySshConnectionId,
          },
        })
      ),
      entityName: task.name,
      hostLabel: project?.repositorySshConnectionId ? project.name : undefined,
      projectPath: project?.repositoryPath ?? undefined,
      workspacePath: workspace?.path ?? undefined,
      branchName: workspace ? (getProvisionedWorkspaceBranch(workspace) ?? undefined) : undefined,
      deleteWorktree: input.deleteWorktree ?? true,
      deleteBranch: input.deleteBranch ?? false,
      workspaceShared,
      createdAt,
    }),
    precondition: (tx, { task }) => projectIsActive(tx, task.projectId),
    tombstone: (tx, { task, taskConversations }) => {
      const changes = tx
        .update(tasks)
        .set({ deletedAt: new Date(createdAt).toISOString() })
        .where(and(eq(tasks.id, task.id), isNull(tasks.deletedAt)))
        .run().changes;
      if (changes === 0) return 0;
      const conversationIds = taskConversations.map((row) => row.id);
      if (deleteConversations) {
        // Cascade accepted: the rows tombstone with the task; per-record host deletes are
        // submitted below (spec §7.2 — the FK cascade no longer determines record lifetime).
        conversationRegistry.untrack(conversationIds, new Date(createdAt).toISOString(), tx);
      } else {
        // Cascade declined: annotation delete — the records orphan into the discovery
        // surface instead of being swept away by the task-row FK cascade.
        for (const id of conversationIds) {
          conversationRegistry.annotate(
            id,
            { taskId: null, projectId: null, isInitialConversation: false },
            tx
          );
        }
      }
      return changes;
    },
    revert: (tx, { task, taskConversations }) => {
      tx.update(tasks).set({ deletedAt: null }).where(eq(tasks.id, task.id)).run();
      if (deleteConversations) {
        conversationRegistry.revertUntrack(
          taskConversations.map((row) => row.id),
          tx
        );
      } else {
        for (const row of taskConversations) {
          conversationRegistry.annotate(
            row.id,
            {
              taskId: row.taskId,
              projectId: row.projectId,
              isInitialConversation: row.isInitialConversation,
            },
            tx
          );
        }
      }
    },
    poke: ({ task }) => {
      appDbPokes.tasks.poke({ projectId: task.projectId, taskId: task.id });
      appDbPokes.conversations.poke({ projectId: task.projectId, taskId: task.id });
    },
  });
  if (result.success) {
    // Shared-workspace guard is an enqueue-time registry query: another live
    // task on the row means unlink only — no host removal. The verb call is
    // fail-fast and best-effort here: desktop task deletion has already
    // committed, and a failure leaves the workspace row live for a later
    // removal from the workspaces surface.
    if (workspaceIdForRemoval && !workspaceShared && input.deleteWorktree !== false) {
      await deleteWorkspaceThroughRegistry(operations, runtimes, workspaceIdForRemoval, {
        deleteBranch: input.deleteBranch ?? false,
      });
    }
    // Explicit per-record host deletes, submitted directly from the enqueue-time snapshot:
    // rows are already untracked in the task tombstone tx, so `enqueueTombstoned` would
    // misread them as duplicates, and the task handler may FK-cascade the mirror rows
    // before a later reload could see them.
    for (const deletion of conversationDeletions) {
      await operations.submit(hostDeleteConversationOperation, deletion);
    }
  }
  return result;
}

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
    if (await context.hasActiveKey(deleteTaskOperationKey(task.id))) continue;
    const [workspace] = task.workspaceId
      ? await context.db
          .select()
          .from(workspaces)
          .where(eq(workspaces.id, task.workspaceId))
          .limit(1)
      : [];
    const [project] = await context.db
      .select({
        name: projects.name,
        repositoryPath: workspaces.path,
        repositoryLocation: workspaces.location,
        repositorySshConnectionId: workspaces.sshConnectionId,
      })
      .from(projects)
      .leftJoin(workspaces, eq(workspaces.id, projects.repositoryWorkspaceId))
      .where(eq(projects.id, task.projectId))
      .limit(1);
    await context.submit(deleteTaskOperation, {
      version: '1',
      source: 'reconciler',
      taskId: task.id,
      projectId: task.projectId,
      workspaceId: task.workspaceId,
      hostRef: formatHostRef(LOCAL_HOST_REF),
      targetHostRef: formatHostRef(
        operationHostRef({
          workspace,
          repository: project && {
            location: project.repositoryLocation,
            sshConnectionId: project.repositorySshConnectionId,
          },
        })
      ),
      entityName: task.name,
      hostLabel: project?.name,
      projectPath: project?.repositoryPath ?? undefined,
      workspacePath: workspace?.path ?? undefined,
      branchName: workspace ? (getProvisionedWorkspaceBranch(workspace) ?? undefined) : undefined,
      // Reconciler proposals only purge desktop rows; worktree removal is an
      // enqueue-time decision that already happened (or was declined).
      deleteWorktree: false,
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
    hostRef: input.targetHostRef ?? input.hostRef,
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
  const workspaceUntracked =
    !!operation.workspaceId && (await lifecycleWorkspaceIsUntracked(db, operation.workspaceId));
  if (workspaceUntracked && context.workspacePath) {
    const workspace = hostFileRefFromNativePath(
      context.workspacePath,
      sshConnectionIdOf(parseHostRef(operation.hostRef))
    );
    await dependencies.unregisterFileSearchRoot(workspace.path, workspace.host);
  }
  db.transaction((tx) => {
    purgeUntrackedTaskConversationRows(db, operation.taskId!, tx);
    tx.delete(tasks).where(eq(tasks.id, operation.taskId!)).run();
  });
  await purgeTaskLocalState(
    { projectId: operation.projectId, taskId: operation.taskId },
    dependencies
  );
}

/**
 * The task cascade is retired (spec §10.5): the task-row delete only nulls surviving
 * links. Tombstoned mirror rows — untracked at enqueue with their own delete verbs in
 * flight — are cleared here through the registry so they don't linger link-less forever.
 */
function purgeUntrackedTaskConversationRows(db: AppDb, taskId: string, tx: DrizzleTx): void {
  const registry = createConversationRegistry(db);
  const untracked = tx
    .select({ id: conversationRows.id })
    .from(conversationRows)
    .where(and(eq(conversationRows.taskId, taskId), isNotNull(conversationRows.untrackedAt)))
    .all();
  registry.purge(
    untracked.map(({ id }) => id),
    tx
  );
}

async function lifecycleWorkspaceIsUntracked(db: AppDb, workspaceId: string): Promise<boolean> {
  const [row] = await db
    .select({ untrackedAt: workspaces.untrackedAt })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return row !== undefined && row.untrackedAt !== null;
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
