import { randomUUID } from 'node:crypto';
import { createOperationHandler, defineOperation } from '@emdash/core/primitives/kernel/api';
import { defineVersionedSchema } from '@emdash/core/primitives/versioned-schema/api';
import { err, type Result } from '@emdash/shared';
import type { Logger } from '@emdash/shared/logger';
import type { Clock } from '@emdash/shared/scheduling';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import z from 'zod';
import type { AutomationsService } from '@core/features/automations/api/node/automations-service';
import { projectEvents } from '@core/features/projects/api/node/project-events';
import type { ProjectSessionManager } from '@core/features/projects/api/node/project-manager';
import { projectSubject } from '@core/features/projects/contributions/subject';
import {
  deleteTaskOperation,
  type DeleteTaskOperationInput,
} from '@core/features/tasks/api/node/delete-task-operation';
import { taskSubject } from '@core/features/tasks/contributions/subject';
import {
  hostRemoveWorktreeOperation,
  type HostRemoveWorktreeInput,
} from '@core/features/workspaces/api/node/host-outbox-operations';
import { classifyWorkspaceOperationError } from '@core/features/workspaces/api/node/operation-error-classifier';
import { compileRemoveWorktreePrediction } from '@core/features/workspaces/api/node/operations/compile-host-outbox-prediction';
import { projectKernelResource } from '@core/primitives/operations/api/resources';
import type { TelemetryService } from '@core/primitives/telemetry/api/telemetry';
import type { AppDb } from '@core/services/app-db/node/db';
import { appDbPokes } from '@core/services/app-db/node/pokes';
import { projects, tasks, workspaces } from '@core/services/app-db/node/schema';
import type {
  OperationDefinition,
  OperationReconcileContext,
  OperationSubmitOptions,
} from '@core/services/operations/node';
import {
  confirmInput,
  isOperationStale,
  needsConfirmation,
  operationErrorSchema,
  operationResultSchema,
  operationRetryPolicy,
  runOperationStage,
} from '@core/services/operations/node';
import type { MementosRuntimeClient } from '@core/services/runtime-broker/api/clients';

const PURGE_TIMEOUT_MS = 30_000;

const deleteProjectInputSchema = defineVersionedSchema()
  .initial(
    '1',
    z.object({
      version: z.literal('1'),
      source: z.enum(['user', 'reconciler']),
      projectId: z.string(),
      hostRef: z.literal('local'),
      entityName: z.string().optional(),
      hostLabel: z.string().optional(),
      confirmedAt: z.number().int().nonnegative().optional(),
      createdAt: z.number().int().nonnegative(),
    })
  )
  .build();

export type DeleteProjectOperationInput = typeof deleteProjectInputSchema.Type;

export const deleteProjectOperation = defineOperation({
  name: 'delete-project',
  input: deleteProjectInputSchema,
  result: operationResultSchema,
  error: operationErrorSchema,
  key: (input) => `project:${input.projectId}`,
  claims: (input) => projectKernelResource.mutates({ projectId: input.projectId }),
  describe: (input) => input.entityName ?? input.projectId,
  retry: operationRetryPolicy,
});

export const deleteProjectOperationContribution = {
  create: (dependencies: DeleteProjectOperationDependencies, runtime: OperationRuntime) => [
    createDeleteProjectOperationDefinition(dependencies, runtime),
  ],
};

export type DeleteProjectOperationDependencies = {
  automations: Pick<AutomationsService, 'removeProjectDeployments'>;
  getMementosRuntimeClient(): Promise<MementosRuntimeClient>;
  logger: Logger;
  projects: Pick<ProjectSessionManager, 'closeProject'>;
  pullRequests: { deleteProjectData(projectId: string): Promise<void> };
  telemetry: Pick<TelemetryService, 'capture'>;
};

type OperationRuntime = { db: AppDb; clock: Clock; initiatedBy?: string };

export function createDeleteProjectOperationDefinition(
  dependencies: DeleteProjectOperationDependencies,
  runtime: OperationRuntime
): OperationDefinition<typeof deleteProjectOperation> {
  const handler = createOperationHandler(deleteProjectOperation, async (ctx) => {
    if (ctx.input.source === 'reconciler' && !ctx.input.confirmedAt) {
      needsConfirmation(ctx, 'reconciler-proposed');
    }
    if (isOperationStale(ctx.input, runtime.clock.now())) {
      needsConfirmation(ctx, 'stale');
    }
    const taskRows = await runtime.db
      .select()
      .from(tasks)
      .where(eq(tasks.projectId, ctx.input.projectId));
    const workspaceIds = taskRows
      .map((task) => task.workspaceId)
      .filter((id): id is string => !!id);
    const workspaceRows =
      workspaceIds.length > 0
        ? await runtime.db.select().from(workspaces).where(inArray(workspaces.id, workspaceIds))
        : [];
    const workspaceById = new Map(workspaceRows.map((row) => [row.id, row]));
    const [project] = await runtime.db
      .select()
      .from(projects)
      .where(eq(projects.id, ctx.input.projectId))
      .limit(1);
    const claimedWorkspaceIds = new Set<string>();
    for (const task of taskRows) {
      const workspace = task.workspaceId ? workspaceById.get(task.workspaceId) : undefined;
      const workspaceAlreadyClaimed =
        task.workspaceId !== null && claimedWorkspaceIds.has(task.workspaceId);
      if (task.workspaceId !== null) claimedWorkspaceIds.add(task.workspaceId);
      runtime.db.transaction((tx) => {
        tx.update(tasks)
          .set({ deletedAt: new Date(runtime.clock.now()).toISOString() })
          .where(and(eq(tasks.id, task.id), isNull(tasks.deletedAt)))
          .run();
      });
      const child: DeleteTaskOperationInput = {
        version: '1',
        source: ctx.input.source,
        taskId: task.id,
        projectId: ctx.input.projectId,
        workspaceId: task.workspaceId,
        hostRef: workspace?.sshConnectionId ?? project?.sshConnectionId ?? 'local',
        entityName: task.name,
        hostLabel: project?.name,
        projectPath: project?.path,
        workspacePath: workspace?.path ?? undefined,
        branchName: workspace?.branchName ?? undefined,
        // Worktree removal is queued as host-remove-worktree outbox entries at
        // enqueue time; children only purge desktop rows.
        deleteWorktree: false,
        deleteBranch: false,
        workspaceShared: workspaceAlreadyClaimed,
        confirmedAt: ctx.input.confirmedAt,
        createdAt: runtime.clock.now(),
      };
      const childResult = await ctx.run(deleteTaskOperation, child);
      if (!childResult.success) {
        throw new Error(`Child delete task operation failed: ${childResult.error.kind}`);
      }
    }
    await runOperationStage(ctx, {
      id: 'purge-project-row',
      timeoutMs: PURGE_TIMEOUT_MS,
      clock: runtime.clock,
      classifyError: classifyWorkspaceOperationError,
      run: async () => {
        await purgeProjectLocalState(
          ctx.input.projectId,
          runtime.db,
          async () => {
            await runtime.db.delete(projects).where(eq(projects.id, ctx.input.projectId));
          },
          dependencies
        );
      },
    });
    return { ok: true as const };
  });

  return {
    definition: deleteProjectOperation,
    handler,
    entityKind: 'project',
    examples: [
      {
        definition: deleteProjectOperation,
        input: {
          version: '1',
          source: 'user',
          projectId: 'project-example',
          hostRef: 'local',
          createdAt: 1,
        },
      },
    ],
    describe: (input) => ({ entityName: input.entityName, hostLabel: input.hostLabel }),
    projectId: (input) => input.projectId,
    hostRef: (input) => input.hostRef,
    confirmedInput: (input, confirmedAt) => confirmInput(input, confirmedAt),
    purge: async ({ input, db }) => {
      await purgeProjectLocalState(
        input.projectId,
        db,
        async () => {
          db.transaction((tx) => {
            const [projectRow] = tx
              .select({ repositoryWorkspaceId: projects.repositoryWorkspaceId })
              .from(projects)
              .where(eq(projects.id, input.projectId))
              .all();
            const workspaceRows = tx
              .select({ id: tasks.workspaceId })
              .from(tasks)
              .where(eq(tasks.projectId, input.projectId))
              .all();
            tx.delete(tasks).where(eq(tasks.projectId, input.projectId)).run();
            const workspaceIds = workspaceRows
              .map((row) => row.id)
              .filter((id): id is string => id !== null);
            if (projectRow?.repositoryWorkspaceId) {
              workspaceIds.push(projectRow.repositoryWorkspaceId);
            }
            tx.delete(projects).where(eq(projects.id, input.projectId)).run();
            if (workspaceIds.length > 0) {
              tx.delete(workspaces).where(inArray(workspaces.id, workspaceIds)).run();
            }
          });
        },
        dependencies
      );
    },
    reconcile: (context) => reconcileProjectCleanups(context),
  };
}

export async function enqueueDeleteProject(operations: OperationsEngineLike, projectId: string) {
  const [project] = await operations.db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);
  if (!project) {
    return err({ type: 'project-not-found', message: `Project ${projectId} was not found` });
  }
  const createdAt = Date.now();
  const registryRows = await loadProjectRegistryRows(operations.db, project);
  const registryIds = registryRows.map((row) => row.id);
  const input: DeleteProjectOperationInput = {
    version: '1',
    source: 'user',
    projectId,
    hostRef: 'local',
    entityName: project.name,
    createdAt,
  };
  const result = await operations.submitWithTombstone(deleteProjectOperation, input, {
    tombstone: (tx) => {
      const changes = tx
        .update(projects)
        .set({ deletedAt: new Date(createdAt).toISOString() })
        .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
        .run().changes;
      if (changes > 0 && registryIds.length > 0) {
        tx.update(workspaces)
          .set({ untrackedAt: new Date(createdAt).toISOString() })
          .where(and(inArray(workspaces.id, registryIds), isNull(workspaces.untrackedAt)))
          .run();
      }
      return changes;
    },
    revertTombstone: (tx) => {
      tx.update(projects).set({ deletedAt: null }).where(eq(projects.id, projectId)).run();
      if (registryIds.length > 0) {
        tx.update(workspaces)
          .set({ untrackedAt: null })
          .where(inArray(workspaces.id, registryIds))
          .run();
      }
    },
  });
  if (result.success) {
    appDbPokes.projects.poke({ projectId });
    appDbPokes.tasks.poke({ projectId });
    appDbPokes.workspaces.poke({ projectId });
    await enqueueProvenanceWorktreeRemovals(operations, project, registryRows, createdAt);
  }
  return result;
}

type ProjectRegistryRow = {
  id: string;
  path: string | null;
  kind: string | null;
  config: unknown;
  branchName: string | null;
  sshConnectionId: string | null;
  observedStatus: string | null;
  lastObservedAt: string | null;
};

/** Tracked registry rows referenced by the project: task workspaces + the repository row. */
async function loadProjectRegistryRows(
  db: AppDb,
  project: { id: string; repositoryWorkspaceId: string | null }
): Promise<ProjectRegistryRow[]> {
  const taskRows = await db
    .select({ workspaceId: tasks.workspaceId })
    .from(tasks)
    .where(eq(tasks.projectId, project.id));
  const candidateIds = new Set(
    taskRows.map((row) => row.workspaceId).filter((id): id is string => id !== null)
  );
  if (project.repositoryWorkspaceId) candidateIds.add(project.repositoryWorkspaceId);
  if (candidateIds.size === 0) return [];
  return db
    .select({
      id: workspaces.id,
      path: workspaces.path,
      kind: workspaces.kind,
      config: workspaces.config,
      branchName: workspaces.branchName,
      sshConnectionId: workspaces.sshConnectionId,
      observedStatus: workspaces.observedStatus,
      lastObservedAt: workspaces.lastObservedAt,
    })
    .from(workspaces)
    .where(and(inArray(workspaces.id, [...candidateIds]), isNull(workspaces.untrackedAt)));
}

/**
 * Queues a `host-remove-worktree` outbox entry per provenance worktree
 * (rows emdash created, `config != NULL`). Adopted rows are untracked only —
 * emdash never removes artifacts it did not create as part of a bulk delete.
 */
async function enqueueProvenanceWorktreeRemovals(
  operations: OperationsEngineLike,
  project: { id: string; name: string; path: string; sshConnectionId: string | null },
  registryRows: readonly ProjectRegistryRow[],
  createdAt: number
): Promise<void> {
  for (const row of registryRows) {
    if (row.kind !== 'worktree' || !row.path || row.config === null) continue;
    const input: HostRemoveWorktreeInput = {
      version: '1',
      source: 'user',
      hostOperationId: randomUUID(),
      hostRef: row.sshConnectionId ?? project.sshConnectionId ?? 'local',
      repoPath: project.path,
      projectId: project.id,
      workspaceId: row.id,
      entityName: row.path,
      hostLabel: project.name,
      workspacePath: row.path,
      branchName: row.branchName ?? undefined,
      deleteBranch: false,
      deactivateConsumers: 'all',
      prediction: compileRemoveWorktreePrediction({
        now: createdAt,
        workspacePath: row.path,
        branchName: row.branchName ?? undefined,
        deleteBranch: false,
        observed: row,
      }),
      createdAt,
    };
    // Rows are already untracked by the project tombstone; admission rejects
    // (e.g. duplicate key) are tolerable — the worktree stays on the host.
    await operations.submitWithTombstone(hostRemoveWorktreeOperation, input);
  }
}

type OperationsEngineLike = {
  db: AppDb;
  submitWithTombstone<D extends typeof deleteProjectOperation | typeof hostRemoveWorktreeOperation>(
    definition: D,
    input: D extends typeof deleteProjectOperation
      ? DeleteProjectOperationInput
      : HostRemoveWorktreeInput,
    options?: OperationSubmitOptions
  ): Promise<Result<{ operationId?: string }, { type: string; message: string }>>;
};

async function reconcileProjectCleanups(context: OperationReconcileContext): Promise<void> {
  const rows = await context.db.select().from(projects).where(isNotNull(projects.deletedAt));
  for (const project of rows) {
    if (await context.hasActiveKey(deleteProjectOperation.key(exampleInput(project.id)))) continue;
    await context.submit(deleteProjectOperation, {
      version: '1',
      source: 'reconciler',
      projectId: project.id,
      hostRef: 'local',
      entityName: project.name,
      createdAt: context.clock.now(),
    });
  }
}

function exampleInput(projectId: string): DeleteProjectOperationInput {
  return { version: '1', source: 'reconciler', projectId, hostRef: 'local', createdAt: 1 };
}

async function purgeProjectLocalState(
  projectId: string,
  db: AppDb,
  purgeDatabaseRows: () => Promise<void>,
  dependencies: DeleteProjectOperationDependencies
): Promise<void> {
  await dependencies.pullRequests.deleteProjectData(projectId);
  await dependencies.projects.closeProject(projectId).catch((error: unknown) => {
    dependencies.logger.warn('operation: failed to close project before purge', {
      projectId,
      error: String(error),
    });
  });
  await dependencies.automations.removeProjectDeployments(projectId);
  await purgeDatabaseRows();
  const client = await dependencies.getMementosRuntimeClient();
  const taskRows = await db.select({ id: tasks.id }).from(tasks);
  const [projectResult, taskResult] = await Promise.all([
    client.deleteBySubject(projectSubject({ projectId })),
    client.deleteOrphans({ kind: taskSubject.kind, validKeys: taskRows.map(({ id }) => id) }),
  ]);
  if (!projectResult.success) throw new Error(projectResult.error.message);
  if (!taskResult.success) throw new Error(taskResult.error.message);
  projectEvents._emit('project:deleted', projectId);
  dependencies.telemetry.capture('project_deleted', { project_id: projectId });
}
