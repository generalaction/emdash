import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import type { Issue, Task, TaskLifecycleStatus } from '@shared/tasks/types';
import { projectManager } from '@main/core/projects/project-manager';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';

export type CreateTaskParams = {
  id?: string;
  projectId: string;
  projectProvider: 'ssh' | 'local';
  /** Absolute path to the main repository */
  projectPath: string;
  name: string;
  /** The branch to fork the new worktree from */
  sourceBranch: string;
  /** If true, create a new git branch before the worktree */
  createBranch?: boolean;
  /** Explicit branch name; auto-generated from name if omitted */
  branchName?: string;
  linkedIssue?: Issue;
};

export async function createTask(params: CreateTaskParams): Promise<Task> {
  const id = params.id ?? randomUUID();
  const suffix = Math.random().toString(36).slice(2, 7);
  const branchName = params.branchName ?? `${params.name}-${suffix}`;
  const worktreesDir = path.join(params.projectPath, '..', 'worktrees');

  let worktreePath: string | undefined;

  // if (params.createBranch && params.projectProvider === 'local') {
  //   const claim = await worktreePoolService.claimReserve(
  //     params.projectId,
  //     params.projectPath,
  //     params.name,
  //     params.sourceBranch
  //   );
  //   worktreePath = claim?.worktree.path;

  //   if (!claim?.worktree) {
  //     const worktreeService = createLocalWorktreeService(params.projectPath, worktreesDir);

  //     const worktree = await worktreeService.createWorktree(branchName, params.sourceBranch);
  //     worktreePath = worktree.path;
  //   }
  // }

  const [taskRow] = await db
    .insert(tasks)
    .values({
      id,
      projectId: params.projectId,
      name: params.name,
      branch: params.createBranch ? branchName : undefined,
      status: 'todo' as TaskLifecycleStatus,
      worktreePath: worktreePath,
      linkedIssue: params.linkedIssue ? JSON.stringify(params.linkedIssue) : null,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .returning();

  const task: Task = {
    id,
    projectId: params.projectId,
    name: params.name,
    branch: params.createBranch ? branchName : undefined,
    status: 'todo' as TaskLifecycleStatus,
    worktreePath: worktreePath,
    linkedIssue: params.linkedIssue ? params.linkedIssue : undefined,
    updatedAt: taskRow.updatedAt,
    createdAt: taskRow.createdAt,
  };

  const workspace = projectManager.getProject(params.projectId);
  if (!workspace) {
    throw new Error('Workspace not found');
  }

  const env = await workspace.provisionTask({
    taskId: id,
    workingDirectory: params.projectPath,
    conversations: [],
    terminals: [],
  });

  return task;
}
