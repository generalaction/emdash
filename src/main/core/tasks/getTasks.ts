import { and, desc, eq } from 'drizzle-orm';
import type { Issue, Task, TaskLifecycleStatus } from '@shared/tasks/types';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';

export async function getTasks(projectId?: string): Promise<Task[]> {
  const rows = projectId
    ? await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.projectId, projectId)))
        .orderBy(desc(tasks.updatedAt))
    : await db.select().from(tasks).orderBy(desc(tasks.updatedAt));

  return rows.map((row) => ({
    id: row.id,
    status: row.status as TaskLifecycleStatus,
    projectId: row.projectId,
    name: row.name,
    worktreePath: row.worktreePath ?? undefined,
    linkedIssue: row.linkedIssue ? (JSON.parse(row.linkedIssue) as Issue) : undefined,
    archivedAt: row.archivedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}
