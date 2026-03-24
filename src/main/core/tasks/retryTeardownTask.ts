import { eq } from 'drizzle-orm';
import { projectManager } from '@main/core/projects/project-manager';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import { mapTaskRowToTask } from './core';

export async function retryTeardownTask(taskId: string): Promise<void> {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!row) throw new Error(`Task not found: ${taskId}`);

  const task = mapTaskRowToTask(row);
  const project = projectManager.getProject(task.projectId);
  if (!project) throw new Error(`Project not found: ${task.projectId}`);

  const result = await project.retryTaskTeardown(taskId);
  if (!result.success) throw new Error(`Failed to teardown task: ${result.error.message}`);
}
