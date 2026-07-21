import { eq } from 'drizzle-orm';
import { clearTaskResourceTeardown } from '@main/core/tasks/task-resource-teardown-state';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';

/**
 * Starts a new lifecycle generation before workspace acquire/setup can create resources.
 * If provisioning later fails, retrying teardown is safer than retaining a stale completion marker.
 */
export async function beginTaskProvisioning(taskId: string): Promise<void> {
  await db
    .update(tasks)
    .set({ lifecycleTeardownAt: null, providerDestroyAt: null })
    .where(eq(tasks.id, taskId));
  clearTaskResourceTeardown(taskId);
}
