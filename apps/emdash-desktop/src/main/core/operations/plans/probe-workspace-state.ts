import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@main/db/client';
import { tasks, type LifecycleOperationRow } from '@main/db/schema';
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
    ? await db
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
