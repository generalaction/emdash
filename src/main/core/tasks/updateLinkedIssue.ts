import { eq } from 'drizzle-orm';
import { Issue } from '@shared/tasks';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import { capture } from '@main/lib/telemetry';

export async function updateLinkedIssue(taskId: string, issue?: Issue) {
  const [task] = await db
    .select({ id: tasks.id, projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  if (!task) return;

  await db
    .update(tasks)
    .set({
      linkedIssue: issue ? JSON.stringify(issue) : null,
    })
    .where(eq(tasks.id, taskId));

  if (issue) {
    capture('issue_linked_to_task', {
      provider: issue.provider,
      project_id: task.projectId,
      task_id: task.id,
    });
  }
}
