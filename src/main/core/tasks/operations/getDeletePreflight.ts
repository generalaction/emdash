import { and, eq, ne } from 'drizzle-orm';
import { projectManager } from '@main/core/projects/project-manager';
import { db } from '@main/db/client';
import { tasks, workspaces } from '@main/db/schema';
import { log } from '@main/lib/logger';
import type { DeletePreflightResult, TaskDeletePreflightItem } from '@shared/tasks';
import { parseWorkspaceConfig } from '@shared/workspace-config';

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
  if (!ws?.branchName) return noWorktreeResult;

  const siblings = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.workspaceId, ws.id), ne(tasks.id, taskId)))
    .limit(1);

  const hasWorktree = siblings.length === 0;

  // A branch is deletable when it was created from a source branch (create-branch intent).
  const wsConfig = parseWorkspaceConfig(ws.config);
  const fromBranch = wsConfig?.git.kind === 'create-branch' ? wsConfig.git.fromBranch : undefined;
  const hasDeletableBranch = hasWorktree && !!fromBranch && ws.branchName !== fromBranch.branch;

  let hasUncommittedChanges = false;
  if (hasWorktree) {
    const project = projectManager.getProject(projectId);
    if (project) {
      try {
        const worktreePath = await project.worktreeService.getWorktree(ws.branchName);
        if (worktreePath) {
          const { stdout } = await project.ctx.exec('git', [
            '-C',
            worktreePath,
            'status',
            '--porcelain',
          ]);
          hasUncommittedChanges = stdout.trim().length > 0;
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
