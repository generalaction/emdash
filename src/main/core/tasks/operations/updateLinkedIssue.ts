import { eq } from 'drizzle-orm';
import { mapTaskRowToTask } from '@main/core/tasks/utils/utils';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import { telemetryService } from '@main/lib/telemetry';
import type { Issue, Task } from '@shared/tasks';

export async function updateLinkedIssue(taskId: string, issue?: Issue): Promise<Task | undefined> {
  const [existingRow] = await db
    .select({ id: tasks.id, projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  if (!existingRow) return undefined;

  const [updatedRow] = await db
    .update(tasks)
    .set({
      linkedIssue: issue ? JSON.stringify(issue) : null,
    })
    .where(eq(tasks.id, taskId))
    .returning();

  if (issue) {
    telemetryService.capture('issue_linked_to_task', {
      provider: issue.provider,
      project_id: existingRow.projectId,
      task_id: existingRow.id,
    });
  }

  return updatedRow ? mapTaskRowToTask(updatedRow) : undefined;
}
