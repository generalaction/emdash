import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Issue, Task, TaskLifecycleStatus } from '@shared/tasks';
import { projectManager } from '@main/core/projects/project-manager';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';

export type CreateTaskParams = {
  id?: string;
  projectId: string;
  name: string;
  /** The branch to fork the new worktree from */
  sourceBranch: string;
  /** If available, create a new git branch before the worktree */
  taskBranch?: string;
  /** The issue to link to the task */
  linkedIssue?: Issue;
};

export async function createTask(params: CreateTaskParams): Promise<Task> {
  const id = params.id ?? randomUUID();
  const suffix = Math.random().toString(36).slice(2, 7);

  const taskBranch = params.taskBranch ? ` ${params.taskBranch}-${suffix}` : undefined;

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

  const workspace = projectManager.getProject(params.projectId);
  if (!workspace) {
    throw new Error('Workspace not found');
  }

  await workspace.provisionTask(task, [], []);

  return task;
}
