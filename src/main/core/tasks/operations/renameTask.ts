import { and, eq, sql } from 'drizzle-orm';
import { projectManager } from '@main/core/projects/project-manager';
import { pullRequestRepositoryScope } from '@main/core/pull-requests/pr-utils';
import { mapTaskRowToTask } from '@main/core/tasks/utils/utils';
import { db } from '@main/db/client';
import { projectRemotes, pullRequests, tasks } from '@main/db/schema';
import { resolveTaskBranchName } from '@shared/resolveTaskBranchName';
import { err, ok, type Result } from '@shared/result';
import type { Issue, RenameTaskError, RenameTaskOptions, RenameTaskSuccess } from '@shared/tasks';
import { appSettingsService } from '../../settings/settings-service';
import { fromStoredBranch } from '../stored-branch';

function parseLinkedIssue(linkedIssue: unknown): Issue | undefined {
  if (!linkedIssue || typeof linkedIssue !== 'string') return undefined;
  try {
    return JSON.parse(linkedIssue) as Issue;
  } catch {
    return undefined;
  }
}

export async function renameTask(
  projectId: string,
  taskId: string,
  newName: string,
  options: RenameTaskOptions = {}
): Promise<Result<RenameTaskSuccess, RenameTaskError>> {
  const [row] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)))
    .limit(1);
  if (!row) return err({ type: 'task-not-found', taskId });

  let taskBranch = row.taskBranch;

  if (options.renameBranch && row.taskBranch) {
    const linkedIssue = parseLinkedIssue(row.linkedIssue);
    if (linkedIssue?.provider === 'linear') {
      return err({ type: 'branch-managed-by-linked-issue', provider: linkedIssue.provider });
    }

    const sourceBranch = fromStoredBranch(row.sourceBranch);

    if (sourceBranch && row.taskBranch !== sourceBranch.branch) {
      const siblings = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.projectId, row.projectId), eq(tasks.taskBranch, row.taskBranch)))
        .limit(2);

      if (siblings.length > 1) {
        return err({ type: 'branch-has-siblings', branch: row.taskBranch });
      }

      const remoteRows = await db
        .select({ remoteUrl: projectRemotes.remoteUrl })
        .from(projectRemotes)
        .where(eq(projectRemotes.projectId, row.projectId));
      const repositoryUrls = remoteRows.map((remote) => remote.remoteUrl);

      if (repositoryUrls.length > 0) {
        const openPrRows = await db
          .select({ url: pullRequests.url })
          .from(pullRequests)
          .where(
            and(
              eq(pullRequests.headRefName, row.taskBranch),
              eq(pullRequests.status, 'open'),
              pullRequestRepositoryScope(repositoryUrls)
            )
          )
          .limit(1);

        if (openPrRows.length > 0) {
          return err({ type: 'branch-has-open-pr', branch: row.taskBranch });
        }
      }

      const project = projectManager.getProject(projectId);
      if (!project) return err({ type: 'project-not-found', projectId });

      const projectDefaults = await appSettingsService.get('project');
      const newBranch = resolveTaskBranchName({
        rawBranch: newName,
        branchPrefix: projectDefaults.branchPrefix ?? '',
        suffix: '',
        appendRandomSuffix: false,
      });

      if (newBranch !== row.taskBranch) {
        const renameResult = await project.repository.renameBranch(row.taskBranch, newBranch);
        if (!renameResult.success) {
          switch (renameResult.error.type) {
            case 'already_exists':
              return err({
                type: 'branch-already-exists',
                branch: renameResult.error.name,
              });
            case 'error':
              return err({
                type: 'branch-rename-failed',
                branch: newBranch,
                message: renameResult.error.message,
              });
          }
        }

        taskBranch = newBranch;
      }
    }
  }

  const [updatedRow] = await db
    .update(tasks)
    .set({
      name: newName,
      ...(taskBranch !== row.taskBranch ? { taskBranch } : {}),
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)))
    .returning();

  const task = updatedRow
    ? mapTaskRowToTask(updatedRow)
    : mapTaskRowToTask({ ...row, name: newName });
  return ok({ task });
}
