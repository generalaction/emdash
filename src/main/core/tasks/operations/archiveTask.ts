import { eq, sql } from 'drizzle-orm';
import { projectManager } from '@main/core/projects/project-manager';
import { taskSessionManager } from '@main/core/tasks/task-session-manager';
import { db } from '@main/db/client';
import { tasks, workspaces } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { deleteIndexIfUnused, removeWorktreeIfUnused } from './task-lifecycle-utils';

export async function archiveTask(projectId: string, taskId: string): Promise<void> {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) return;

  const project = projectManager.getProject(projectId);

  await db
    .update(tasks)
    .set({
      status: 'archived',
      archivedAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
      statusChangedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(tasks.id, taskId));
  telemetryService.capture('task_archived', { project_id: projectId, task_id: taskId });

  if (!project) return;

  const teardownResult = await taskSessionManager.teardownTask(taskId, 'terminate').catch((e) => {
    log.warn('archiveTask: teardown failed', { taskId, error: String(e) });
    return null;
  });

  if (teardownResult && !teardownResult.success) {
    log.warn('archiveTask: teardown failed', { taskId, error: teardownResult.error.message });
  }

  let wsRow: { id: string; branchName: string | null } | undefined;
  if (task.workspaceId) {
    const [ws] = await db
      .select({ id: workspaces.id, branchName: workspaces.branchName })
      .from(workspaces)
      .where(eq(workspaces.id, task.workspaceId))
      .limit(1);
    if (ws) wsRow = ws;
  }

  if (wsRow) {
    await removeWorktreeIfUnused(wsRow, project, true);
  }

  if (task.workspaceId) {
    await deleteIndexIfUnused(task.workspaceId);
  }
}
