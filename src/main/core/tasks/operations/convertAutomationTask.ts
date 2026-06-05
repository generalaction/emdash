import { and, eq, or, sql } from 'drizzle-orm';
import { db } from '@main/db/client';
import { automationRuns, tasks } from '@main/db/schema';
import type { Task } from '@shared/tasks';
import { mapTaskRowToTask } from '../utils/utils';

export async function convertAutomationTask(taskId: string): Promise<Task | null> {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!row) return null;

  db.transaction((tx) => {
    const [activeRun] = tx
      .select({ id: automationRuns.id })
      .from(automationRuns)
      .where(
        and(
          eq(automationRuns.taskId, taskId),
          or(
            eq(automationRuns.status, 'queued'),
            eq(automationRuns.status, 'creating_task'),
            eq(automationRuns.status, 'launching_task'),
            eq(automationRuns.status, 'creating_conversation')
          )
        )
      )
      .limit(1)
      .all();
    if (activeRun) throw new Error('automation_run_in_flight');

    tx.update(automationRuns).set({ taskId: null }).where(eq(automationRuns.taskId, taskId)).run();

    tx.update(tasks)
      .set({ updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(tasks.id, taskId))
      .run();
  });

  return {
    ...mapTaskRowToTask({ ...row, updatedAt: new Date().toISOString() }),
    prs: [],
    conversations: {},
  };
}
