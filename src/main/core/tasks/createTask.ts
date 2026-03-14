import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { CreateTaskParams, Task, TaskLifecycleStatus } from '@shared/tasks';
import { projectManager } from '@main/core/projects/project-manager';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import { appSettingsService } from '../settings/settings-service';

export async function createTask(params: CreateTaskParams): Promise<Task> {
  const id = params.id ?? randomUUID();
  const suffix = Math.random().toString(36).slice(2, 7);
  const branchPrefix = (await appSettingsService.get('localProject')).branchPrefix ?? '';

  const taskBranch = params.taskBranch
    ? branchPrefix
      ? `${branchPrefix}/${params.taskBranch}-${suffix}`
      : `${params.taskBranch}-${suffix}`
    : undefined;

  const [taskRow] = await db
    .insert(tasks)
    .values({
      id,
      projectId: params.projectId,
      name: params.name,
      taskBranch: taskBranch,
      status: 'todo' as TaskLifecycleStatus,
      sourceBranch: params.sourceBranch,
      linkedIssue: params.linkedIssue ? JSON.stringify(params.linkedIssue) : null,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .returning();

  const task: Task = {
    id,
    projectId: params.projectId,
    name: params.name,
    status: 'todo' as TaskLifecycleStatus,
    sourceBranch: params.sourceBranch,
    taskBranch: taskBranch,
    linkedIssue: params.linkedIssue ? params.linkedIssue : undefined,
    createdAt: taskRow.createdAt,
    updatedAt: taskRow.updatedAt,
  };

  const project = projectManager.getProject(params.projectId);
  if (!project) {
    throw new Error('Project not found');
  }

  await project.provisionTask(task, [], []);

  return task;
}
