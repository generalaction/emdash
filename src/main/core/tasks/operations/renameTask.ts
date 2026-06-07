import { and, eq, sql } from 'drizzle-orm';
import { mapTaskRowToTask } from '@main/core/tasks/utils/utils';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import type { RenameTaskError, RenameTaskSuccess } from '@shared/core/tasks/tasks';
import { err, ok, type Result } from '@shared/lib/result';

export async function renameTask(
  projectId: string,
  taskId: string,
  newName: string
): Promise<Result<RenameTaskSuccess, RenameTaskError>> {
  const [row] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)))
    .limit(1);
  if (!row) return err({ type: 'task-not-found', taskId });

  const [updatedRow] = await db
    .update(tasks)
    .set({ name: newName, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)))
    .returning();

  return ok({ task: mapTaskRowToTask(updatedRow ?? { ...row, name: newName }) });
}
