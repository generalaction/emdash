import { err, ok, type Result } from '@emdash/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { RenameTaskError, RenameTaskSuccess } from '@core/primitives/tasks/api';
import { tasks } from '@core/services/app-db/node/schema';
import { mapTaskRowToTask } from '@main/core/tasks/utils/utils';
import { getAppDb } from '@main/db/instance';

export async function renameTask(
  projectId: string,
  taskId: string,
  newName: string
): Promise<Result<RenameTaskSuccess, RenameTaskError>> {
  const [row] = await getAppDb()
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId), isNull(tasks.deletedAt)))
    .limit(1);
  if (!row) return err({ type: 'task-not-found', taskId });

  const [updatedRow] = await getAppDb()
    .update(tasks)
    .set({ name: newName, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId), isNull(tasks.deletedAt)))
    .returning();

  return ok({ task: mapTaskRowToTask(updatedRow ?? { ...row, name: newName }) });
}
