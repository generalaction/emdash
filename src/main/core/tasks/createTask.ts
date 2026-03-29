import { eq, sql } from 'drizzle-orm';
import type { CreateTaskParams, Task, TaskLifecycleStatus } from '@shared/tasks';
import { projectManager } from '@main/core/projects/project-manager';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import { createConversation } from '../conversations/createConversation';
import { appSettingsService } from '../settings/settings-service';

export async function createTask(params: CreateTaskParams): Promise<Task> {
  const id = params.id;
  const suffix = Math.random().toString(36).slice(2, 7);
  const branchPrefix = (await appSettingsService.get('localProject')).branchPrefix ?? '';

  let taskBranch: string | undefined;

  if (params.checkoutInWorktree) {
    taskBranch = params.sourceBranch.branch;
  } else if (params.taskBranch) {
    taskBranch = branchPrefix
      ? `${branchPrefix}/${params.taskBranch}-${suffix}`
      : `${params.taskBranch}-${suffix}`;
  }

  const project = projectManager.getProject(params.projectId);
  if (!project) {
    throw new Error('Project not found');
  }

  if (taskBranch && !params.checkoutInWorktree) {
    const createResult = await project.git.createBranch(
      taskBranch,
      params.sourceBranch.branch,
      !!params.sourceBranch.remote,
      params.sourceBranch.remote || 'origin'
    );
    if (!createResult.success) {
      throw new Error(`Failed to create branch '${taskBranch}': ${createResult.error.type}`);
    }
    if (params.pushBranch) {
      await project.git.publishBranch(taskBranch, params.sourceBranch.remote || 'origin');
    }
  }

  const [taskRow] = await db
    .insert(tasks)
    .values({
      id,
      projectId: params.projectId,
      name: params.name,
      taskBranch: taskBranch,
      status: 'todo' as TaskLifecycleStatus,
      sourceBranch: params.sourceBranch.branch,
      linkedIssue: params.linkedIssue ? JSON.stringify(params.linkedIssue) : null,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .returning();

  const task: Task = {
    id,
    projectId: params.projectId,
    name: params.name,
    status: 'todo' as TaskLifecycleStatus,
    sourceBranch: params.sourceBranch.branch,
    taskBranch: taskBranch,
    linkedIssue: params.linkedIssue ? params.linkedIssue : undefined,
    createdAt: taskRow.createdAt,
    updatedAt: taskRow.updatedAt,
  };

  const provisionResult = await project.provisionTask(task, [], []);
  if (!provisionResult.success) {
    throw new Error(`Failed to provision task: ${provisionResult.error.message}`);
  }

  const lastInteractedAt = new Date().toISOString();
  await db
    .update(tasks)
    .set({ lastInteractedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(tasks.id, id));

  if (params.initialConversation) {
    await createConversation(params.initialConversation);
  }

  return { ...task, lastInteractedAt };
}
