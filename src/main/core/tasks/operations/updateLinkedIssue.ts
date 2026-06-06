import { eq } from 'drizzle-orm';
import { mapTaskRowToTask } from '@main/core/tasks/utils/utils';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import { telemetryService } from '@main/lib/telemetry';
import type { LinkedIssue } from '@shared/linked-issue';
import type { Task } from '@shared/tasks';

export async function updateLinkedIssue(
  taskId: string,
  issue?: LinkedIssue
): Promise<Task | undefined> {
  const [existingRow] = await db
    .select({ id: tasks.id, projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  if (!existingRow) return undefined;

  const [updatedRow] = await db
    .update(tasks)
    .set({
      linkedIssue: issue ?? null,
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
