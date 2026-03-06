import { db } from '@/db/client';
import { tasks } from '@/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import type { Task } from './core';
import { mapTaskRow } from './createTask';

export async function getTasks(projectId?: string): Promise<Task[]> {
  const rows = projectId
    ? await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.projectId, projectId)))
        .orderBy(desc(tasks.updatedAt))
    : await db.select().from(tasks).orderBy(desc(tasks.updatedAt));

  return rows.map(mapTaskRow);
}
