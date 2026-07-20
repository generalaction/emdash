import { and, eq, isNull } from 'drizzle-orm';
import { tasks, type LifecycleOperationRow } from '@core/services/app-db/node/schema';
import { getAppDb } from '@main/db/instance';
import { resolveOperationContext, type OperationContext } from '../operation-context';
import { resolveSessionTargets, type SessionTargets } from '../session-targets';

export type WorkspaceOperationProbe = {
  inUse: boolean;
  sessionTargets: SessionTargets;
  context: OperationContext;
};

export async function probeWorkspaceState(
  operation: LifecycleOperationRow
): Promise<WorkspaceOperationProbe> {
  const context = await resolveOperationContext(operation, { resolveRuntimeConfig: true });
  const sessionTargets = await resolveSessionTargets(operation, context);
  const workspaceId = operation.workspaceId ?? context.workspace?.id;
  const [liveTask] = workspaceId
    ? await getAppDb()
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.workspaceId, workspaceId), isNull(tasks.deletedAt)))
        .limit(1)
    : [];

  return {
    inUse: liveTask !== undefined,
    sessionTargets,
    context,
  };
}
