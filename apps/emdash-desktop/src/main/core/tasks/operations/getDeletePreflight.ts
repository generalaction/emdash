import { and, eq, ne } from 'drizzle-orm';
import { projectManager } from '@main/core/projects/project-manager';
import { runtimeManager } from '@main/core/runtime/runtime-manager';
import { getProvisionedWorkspaceBranch } from '@main/core/workspaces/workspace-branch';
import { db } from '@main/db/client';
import { tasks, workspaces } from '@main/db/schema';
import { log } from '@main/lib/logger';
import type { DeletePreflightResult, TaskDeletePreflightItem } from '@shared/core/tasks/tasks';

async function getTaskPreflight(
  projectId: string,
  taskId: string
): Promise<TaskDeletePreflightItem> {
  const noWorktreeResult: TaskDeletePreflightItem = {
    taskId,
    hasWorktree: false,
    hasUncommittedChanges: false,
    hasDeletableBranch: false,
  };

  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task?.workspaceId) return noWorktreeResult;

  const [ws] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, task.workspaceId))
    .limit(1);
  if (!ws) return noWorktreeResult;

  const provisionedBranch = getProvisionedWorkspaceBranch(ws);
  if (!provisionedBranch) return noWorktreeResult;

  const siblings = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.workspaceId, ws.id), ne(tasks.id, taskId)))
    .limit(1);

  const hasWorktree = siblings.length === 0;

  // A branch is deletable when it was created from a source branch (create-branch intent).
  const fromBranch = ws.config?.git.kind === 'create-branch' ? ws.config.git.fromBranch : undefined;
  const hasDeletableBranch = hasWorktree && !!fromBranch && provisionedBranch !== fromBranch.branch;

  let hasUncommittedChanges = false;
  if (hasWorktree) {
    const project = projectManager.getProject(projectId);
    if (project) {
      try {
        const worktreePath = await project.worktreeService.getWorktree(provisionedBranch);
        if (worktreePath) {
          const runtimeLease = await runtimeManager.acquire(project.defaultWorkspaceMachine);
          try {
            const worktreeLease = await runtimeLease.value.git.openWorktree(worktreePath);
            try {
              const status = await worktreeLease.value.getStatus();
              if (status.kind === 'error') {
                log.warn('getDeletePreflight: git status check failed', {
                  taskId,
                  error: status.message,
                });
              }
              if (status.kind === 'ok') {
                hasUncommittedChanges = status.staged.length > 0 || status.unstaged.length > 0;
              }
              hasUncommittedChanges = status.kind === 'too-many-files';
            } finally {
              worktreeLease.release();
            }
          } finally {
            runtimeLease.release();
          }
        }
      } catch (e) {
        log.warn('getDeletePreflight: git status check failed', { taskId, error: String(e) });
      }
    }
  }

  return { taskId, hasWorktree, hasUncommittedChanges, hasDeletableBranch };
}

export async function getDeletePreflight(
  projectId: string,
  taskIds: string[]
): Promise<DeletePreflightResult> {
  const items = await Promise.all(taskIds.map((id) => getTaskPreflight(projectId, id)));
  return { tasks: items };
}
