import { and, eq, sql } from 'drizzle-orm';
import { err, ok, type Result } from '@shared/result';
import type { RenameTaskError, RenameTaskSuccess, RenameTaskWarning } from '@shared/tasks';
import { projectManager } from '@main/core/projects/project-manager';
import { taskEvents } from '@main/core/tasks/task-events';
import { mapTaskRowToTask } from '@main/core/tasks/utils/utils';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import { appSettingsService } from '../../settings/settings-service';
import { resolveTaskBranchName } from '../resolveTaskBranchName';

function parseLinkedIssueProvider(linkedIssue: unknown): unknown {
  if (!linkedIssue || typeof linkedIssue !== 'string') return undefined;
  try {
    return (JSON.parse(linkedIssue) as { provider?: unknown }).provider;
  } catch {
    return undefined;
  }
}

export async function renameTask(
  projectId: string,
  taskId: string,
  newName: string
): Promise<Result<RenameTaskSuccess, RenameTaskError>> {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!row) return err({ type: 'task-not-found', taskId });

  const project = projectManager.getProject(projectId);
  if (!project) return err({ type: 'project-not-found', projectId });

  const oldBranch = row.taskBranch;
  const sourceBranch = row.sourceBranch ?? undefined;
  let newBranch: string | null = null;
  let warning: RenameTaskWarning | undefined;

  if (oldBranch) {
    if (sourceBranch && oldBranch !== sourceBranch.branch) {
      const siblings = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.projectId, row.projectId), eq(tasks.taskBranch, oldBranch)))
        .limit(2);

      if (siblings.length === 1) {
        const suffix = Math.random().toString(36).slice(2, 7);
        const projectDefaults = await appSettingsService.get('project');
        const branchPrefix = projectDefaults.branchPrefix ?? '';
        const linkedIssueProvider = parseLinkedIssueProvider(row.linkedIssue);
        newBranch = resolveTaskBranchName({
          rawBranch: newName,
          branchPrefix,
          suffix,
          appendRandomSuffix: projectDefaults.appendRandomBranchSuffix ?? true,
          disableRandomSuffix: linkedIssueProvider === 'linear',
        });

        const renameResult = await project.repository.renameBranch(oldBranch, newBranch);
        if (!renameResult.success) {
          switch (renameResult.error.type) {
            case 'already_exists':
              return err({
                type: 'branch-already-exists',
                branch: renameResult.error.name,
              });
            case 'remote_push_failed':
              warning = {
                type: 'branch-remote-push-failed',
                branch: newBranch,
                message: renameResult.error.message,
              };
              break;
            case 'error':
              return err({
                type: 'branch-rename-failed',
                branch: newBranch,
                message: renameResult.error.message,
              });
          }
        }
      }
    }
  }

  const [updatedRow] = await db
    .update(tasks)
    .set({
      name: newName,
      taskBranch: newBranch ?? row.taskBranch,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(tasks.id, taskId))
    .returning();

  if (updatedRow) {
    taskEvents._emit('task:updated', mapTaskRowToTask(updatedRow));
  }

  return ok({ warning });
}
