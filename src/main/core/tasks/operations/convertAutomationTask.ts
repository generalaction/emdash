import { eq, or, sql } from 'drizzle-orm';
import { db } from '@main/db/client';
import { automationRuns, tasks } from '@main/db/schema';
import type { Task } from '@shared/tasks';
import { mapTaskRowToTask } from '../utils/utils';

export async function convertAutomationTask(taskId: string): Promise<Task | null> {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!row) return null;

  await db
    .update(automationRuns)
    .set({ createdTaskId: null })
    .where(or(eq(automationRuns.createdTaskId, taskId), eq(automationRuns.taskId, taskId)));

  await db
    .update(tasks)
    .set({ updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(tasks.id, taskId));

  return {
    ...mapTaskRowToTask({ ...row, updatedAt: new Date().toISOString() }),
    prs: [],
    conversations: {},
  };
}
