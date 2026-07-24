import { ok, err } from '@emdash/shared';
import type { Logger } from '@emdash/shared/logger';
import { and, desc, eq, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm';
import type { AutomationsService } from '@core/features/automations/api/node/automations-service';
import { projectEvents } from '@core/features/projects/api/node/project-events';
import type { ProjectSessionManager } from '@core/features/projects/api/node/project-manager';
import { projectSubject } from '@core/features/projects/contributions/subject';
import { taskSubject } from '@core/features/tasks/contributions/subject';
import { nonTerminalOperationStatuses } from '@core/primitives/operations/api';
import type { TelemetryService } from '@core/primitives/telemetry/api/telemetry';
import {
  lifecycleOperations,
  projects,
  tasks,
  workspaces,
} from '@core/services/app-db/node/schema';
import {
  isOperationStale,
  operationNeedsConfirmation,
  runOperationActions,
  type OperationDefinition,
  type OperationSubmit,
  type OperationsEngine,
} from '@core/services/operations/node';
import type { MementosRuntimeClient } from '@core/services/runtime-broker/api/clients';

const PURGE_TIMEOUT_MS = 30_000;
const reconcilerDedupeStatuses = [...nonTerminalOperationStatuses, 'abandoned'] as const;

export type DeleteProjectOperationDependencies = {
  automations: Pick<AutomationsService, 'removeProjectDeployments'>;
  getMementosRuntimeClient(): Promise<MementosRuntimeClient>;
  logger: Logger;
  projects: Pick<ProjectSessionManager, 'closeProject'>;
  pullRequests: { deleteProjectData(projectId: string): Promise<void> };
  telemetry: Pick<TelemetryService, 'capture'>;
};

export function createDeleteProjectOperationDefinition(
  dependencies: DeleteProjectOperationDependencies
): OperationDefinition {
  return {
    kind: 'delete-project',
    entityKind: 'project',
    async describe({ operation, db }) {
      const [project] = operation.projectId
        ? await db.select().from(projects).where(eq(projects.id, operation.projectId)).limit(1)
        : [];
      return { entityName: project?.name };
    },
    async isReady({ operation, db }) {
      if (!operation.projectId) return true;
      const [child] = await db
        .select({ id: lifecycleOperations.id })
        .from(lifecycleOperations)
        .where(
          and(
            eq(lifecycleOperations.projectId, operation.projectId),
            ne(lifecycleOperations.id, operation.id),
            inArray(lifecycleOperations.status, [...nonTerminalOperationStatuses])
          )
        )
        .limit(1);
      return !child;
    },
    async run(runContext) {
      const { operation, clock, db } = runContext;
      if (isOperationStale(operation, clock.now())) {
        return operationNeedsConfirmation('stale');
      }
      return runOperationActions(runContext, [
        {
          id: 'purge-project-row',
          timeoutMs: PURGE_TIMEOUT_MS,
          run: async () => {
            if (!operation.projectId) return;
            await purgeProjectLocalState(
              operation.projectId,
              db,
              async () => {
                await db.delete(projects).where(eq(projects.id, operation.projectId!));
              },
              dependencies
            );
          },
        },
      ]);
    },
    async retry({ operation, db, reset }) {
      if (!operation.projectId) {
        db.transaction((tx) => reset(tx));
        return;
      }
      const operations = await db
        .select()
        .from(lifecycleOperations)
        .where(
          and(
            eq(lifecycleOperations.projectId, operation.projectId),
            inArray(lifecycleOperations.status, [...nonTerminalOperationStatuses])
          )
        );
      db.transaction((tx) => {
        for (const item of operations) reset(tx, item);
      });
    },
    async forget({ operation, db, markAbandoned }) {
      if (!operation.projectId) {
        db.transaction((tx) => markAbandoned(tx));
        return;
      }
      const projectId = operation.projectId;
      const operations = await db
        .select()
        .from(lifecycleOperations)
        .where(
          and(
            eq(lifecycleOperations.projectId, projectId),
            inArray(lifecycleOperations.status, [...nonTerminalOperationStatuses])
          )
        );
      await purgeProjectLocalState(
        projectId,
        db,
        async () => {
          db.transaction((tx) => {
            for (const item of operations) markAbandoned(tx, item);
            const workspaceRows = tx
              .select({ id: tasks.workspaceId })
              .from(tasks)
              .where(eq(tasks.projectId, projectId))
              .all();
            tx.delete(tasks).where(eq(tasks.projectId, projectId)).run();
            const workspaceIds = workspaceRows
              .map((row) => row.id)
              .filter((id): id is string => id !== null);
            if (workspaceIds.length > 0) {
              tx.delete(workspaces)
                .where(
                  and(
                    inArray(workspaces.id, workspaceIds),
                    or(ne(workspaces.kind, 'project-root'), isNull(workspaces.kind))
                  )
                )
                .run();
            }
            tx.delete(projects).where(eq(projects.id, projectId)).run();
          });
        },
        dependencies
      );
    },
  };
}

export async function enqueueDeleteProject(operations: OperationsEngine, projectId: string) {
  return operations.submit(async ({ db, clock }) => {
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .limit(1);
    if (!project) {
      const [existing] = await db
        .select({ id: lifecycleOperations.id })
        .from(lifecycleOperations)
        .where(
          and(
            eq(lifecycleOperations.entityKey, projectId),
            eq(lifecycleOperations.kind, 'delete-project'),
            inArray(lifecycleOperations.status, [...nonTerminalOperationStatuses])
          )
        )
        .orderBy(desc(lifecycleOperations.createdAt))
        .limit(1);
      return existing
        ? ok({ outcome: 'existing' as const, operationId: existing.id })
        : err({
            type: 'project-not-found',
            message: `Project ${projectId} was not found`,
          });
    }
    const taskRows = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt)));
    const workspaceIds = taskRows
      .map((task) => task.workspaceId)
      .filter((id): id is string => !!id);
    const workspaceRows =
      workspaceIds.length > 0
        ? await db.select().from(workspaces).where(inArray(workspaces.id, workspaceIds))
        : [];
    const workspaceById = new Map(workspaceRows.map((row) => [row.id, row]));
    const createdAt = clock.now();
    return ok({
      outcome: 'enqueue' as const,
      draft: {
        kind: 'delete-project' as const,
        projectId,
        entityKey: projectId,
        hostRef: 'local',
        payload: {
          version: '1' as const,
          source: 'user' as const,
          entityName: project.name,
        },
        createdAt,
      },
      options: {
        dedupeStatuses: nonTerminalOperationStatuses,
        tombstone: (tx) =>
          tx
            .update(projects)
            .set({ deletedAt: new Date(createdAt).toISOString() })
            .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
            .run().changes,
      },
      related: taskRows.map((task) => ({
        draft: {
          kind: 'delete-task' as const,
          projectId,
          taskId: task.id,
          workspaceId: task.workspaceId,
          entityKey: task.id,
          hostRef:
            (task.workspaceId ? workspaceById.get(task.workspaceId)?.sshConnectionId : undefined) ??
            project.sshConnectionId ??
            'local',
          payload: {
            version: '1' as const,
            source: 'user' as const,
            entityName: task.name,
            hostLabel: project.name,
            deleteWorktree: true,
            deleteBranch: false,
          },
          createdAt,
        },
        options: {
          tombstone: (tx) =>
            tx
              .update(tasks)
              .set({ deletedAt: new Date(createdAt).toISOString() })
              .where(and(eq(tasks.id, task.id), isNull(tasks.deletedAt)))
              .run().changes,
        },
      })),
    });
  });
}

export async function submitReconcilerProjectCleanup(
  submit: OperationSubmit,
  projectId: string
): Promise<void> {
  await submit(async ({ db }) => {
    const [existing] = await db
      .select({ id: lifecycleOperations.id })
      .from(lifecycleOperations)
      .where(
        and(
          eq(lifecycleOperations.entityKey, projectId),
          eq(lifecycleOperations.kind, 'delete-project'),
          inArray(lifecycleOperations.status, [...reconcilerDedupeStatuses])
        )
      )
      .limit(1);
    if (existing) return ok({ outcome: 'existing' as const, operationId: existing.id });
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), isNotNull(projects.deletedAt)))
      .limit(1);
    if (!project) return ok({ outcome: 'existing' as const });
    return ok({
      outcome: 'enqueue' as const,
      draft: {
        kind: 'delete-project' as const,
        status: 'awaiting-confirmation' as const,
        projectId,
        entityKey: projectId,
        hostRef: 'local',
        payload: {
          version: '1' as const,
          source: 'reconciler' as const,
          entityName: project.name,
          confirmationReason: 'reconciler-proposed' as const,
        },
      },
      options: { dedupeStatuses: reconcilerDedupeStatuses },
    });
  });
}

async function purgeProjectLocalState(
  projectId: string,
  db: Parameters<OperationDefinition['run']>[0]['db'],
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
