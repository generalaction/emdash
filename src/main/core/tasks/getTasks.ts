import { and, desc, eq } from 'drizzle-orm';
import { Task } from '@shared/tasks';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import { mapTaskRowToTask } from './core';

export async function getTasks(projectId?: string): Promise<Task[]> {
  const rows = projectId
    ? await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.projectId, projectId)))
        .orderBy(desc(tasks.updatedAt))
    : await db.select().from(tasks).orderBy(desc(tasks.updatedAt));

  return rows.map((row) => mapTaskRowToTask(row));
}
