import { eq } from 'drizzle-orm';
import { Issue } from '@shared/tasks';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';

export async function updateLinkedIssue(taskId: string, issue?: Issue) {
  await db
    .update(tasks)
    .set({
      linkedIssue: issue ? JSON.stringify(issue) : null,
    })
    .where(eq(tasks.id, taskId))
    .returning();
}
