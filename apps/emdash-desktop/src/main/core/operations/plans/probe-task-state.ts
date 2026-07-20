import { and, eq, isNull, ne } from 'drizzle-orm';
import { tasks, type LifecycleOperationRow } from '@core/services/app-db/node/schema';
import { getAppDb } from '@main/db/instance';
import { resolveOperationContext, type OperationContext } from '../operation-context';
import { resolveSessionTargets, type SessionTargets } from '../session-targets';

export type TaskOperationProbe = OperationContext & {
  sessionTargets: SessionTargets;
  workspaceSharedWithLiveTasks: boolean;
};

export async function probeTaskState(
  operation: LifecycleOperationRow
): Promise<TaskOperationProbe> {
  const context = await resolveOperationContext(operation, { resolveRuntimeConfig: true });
  const [sessionTargets, otherTaskRows] = await Promise.all([
    resolveSessionTargets(operation, context),
    context.task?.workspaceId
      ? getAppDb()
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

  return {
    ...context,
    sessionTargets,
    workspaceSharedWithLiveTasks: otherTaskRows.length > 0,
  };
}
