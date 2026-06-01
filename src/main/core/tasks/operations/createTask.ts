import crypto from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { projectManager } from '@main/core/projects/project-manager';
import { providerRepositoryService } from '@main/core/repository/provider-repository-service';
import { db } from '@main/db/client';
import { tasks, workspaces } from '@main/db/schema';
import { resolveTaskBranchName } from '@shared/resolveTaskBranchName';
import { err, ok, type Result } from '@shared/result';
import type {
  CreateTaskError,
  CreateTaskParams,
  CreateTaskSuccess,
  CreateTaskWarning,
  TaskLifecycleStatus,
} from '@shared/tasks';
import { prQueryService } from '../../pull-requests/pr-query-service';
import { appSettingsService } from '../../settings/settings-service';
import { toStoredBranch } from '../stored-branch';
import { mapTaskRowToTask } from '../utils/utils';

export async function createTask(
  params: CreateTaskParams
): Promise<Result<CreateTaskSuccess, CreateTaskError>> {
  const { strategy } = params;
  let warning: CreateTaskWarning | undefined;

  const project = projectManager.getProject(params.projectId);
  if (!project) {
    return err({ type: 'project-not-found' });
  }
  const configuredRemotes = await project.repository
    .getConfiguredRemotes()
    .catch((error: unknown) => ({
      baseRemote: 'unknown',
      pushRemote: 'unknown',
      error: error instanceof Error ? error.message : String(error),
    }));
  const { baseRemote, pushRemote } = configuredRemotes;

  // Settings used by from-pull-request branch resolution (new-branch and from-issue resolve
  // the branch name on the FE via resolveTaskBranchName before submission).
  const projectDefaults = await appSettingsService.get('project');
  const branchPrefix = projectDefaults.branchPrefix ?? '';
  const appendRandomSuffix = projectDefaults.appendRandomBranchSuffix ?? true;
  const suffix = Math.random().toString(36).slice(2, 7);

  // Determines what gets stored as taskBranch in the DB and how the worktree is prepared.
  let taskBranch: string | undefined;
  // sourceBranch stored in the DB — defaults to params.sourceBranch but overridden for PRs.
  let dbSourceBranch = params.sourceBranch;

  switch (strategy.kind) {
    case 'new-branch': {
      // The FE resolves the final branch name before submission via resolveTaskBranchName.
      taskBranch = strategy.taskBranch;
      const repoInfo = await project.repository.getRepositoryInfo();
      if (repoInfo.isUnborn) {
        return err({
          type: 'initial-commit-required',
          branch: repoInfo.currentBranch ?? params.sourceBranch.branch,
        });
      }
      const createResult = await project.repository.createBranch(
        taskBranch,
        params.sourceBranch.branch,
        params.sourceBranch.type === 'remote',
        params.sourceBranch.type === 'remote' ? params.sourceBranch.remote.name : undefined
      );
      if (!createResult.success) {
        // If the branch already exists locally (e.g. a prior task was deleted but branch
        // cleanup failed), treat it as non-fatal — checkoutBranchWorktree will find and
        // reuse it during provision.
        if (createResult.error.type !== 'already_exists') {
          return err({
            type: 'branch-create-failed',
            branch: taskBranch,
            error: createResult.error,
          });
        }
      } else if (strategy.pushBranch) {
        if ('error' in configuredRemotes) {
          warning = {
            type: 'branch-publish-failed',
            branch: taskBranch,
            remote: 'unknown',
            error: { type: 'error', message: configuredRemotes.error },
          };
          break;
        }
        const publishResult = await project.repository.publishBranch(taskBranch, pushRemote);
        if (!publishResult.success) {
          warning = {
            type: 'branch-publish-failed',
            branch: taskBranch,
            remote: pushRemote,
            error: publishResult.error,
          };
        }
      }
      break;
    }

    case 'checkout-existing': {
      // taskBranch === sourceBranch tells the provider to use checkoutExistingBranch.
      taskBranch = params.sourceBranch.branch;
      break;
    }

    case 'from-pull-request': {
      // If the head branch is already checked out in a valid worktree, skip the fetch.
      // Git refuses to update a branch that is currently checked out, even with --force.
      const existingWorktree = await project.worktreeService.findBranchAnywhere(
        strategy.headBranch
      );

      if (!existingWorktree) {
        if ('error' in configuredRemotes) {
          return err({
            type: 'pr-fetch-failed',
            error: { type: 'error', message: configuredRemotes.error },
            remote: 'unknown',
          });
        }
        // Fetch the PR head — handles same-repo and fork PRs.
        // Uses headRefName directly as the local branch name (same as `gh pr checkout`).
        const fetchResult = await project.repository.fetchPrForReview(
          strategy.prNumber,
          strategy.headBranch,
          strategy.headRepositoryUrl,
          strategy.headBranch,
          strategy.isFork,
          baseRemote
        );
        if (!fetchResult.success) {
          return err({
            type: 'pr-fetch-failed',
            error: fetchResult.error,
            remote: baseRemote,
          });
        }
      }

      dbSourceBranch = { type: 'local', branch: strategy.headBranch };

      if (strategy.taskBranch) {
        // Create a new task branch on top of the just-fetched local head branch.
        const rawBranch = strategy.taskBranch;
        taskBranch = resolveTaskBranchName({
          rawBranch,
          branchPrefix,
          suffix,
          appendRandomSuffix,
        });
        const createResult = await project.repository.createBranch(
          taskBranch,
          strategy.headBranch,
          false
        );
        if (!createResult.success) {
          return err({
            type: 'branch-create-failed',
            branch: taskBranch,
            error: createResult.error,
          });
        }
        if (strategy.pushBranch) {
          if ('error' in configuredRemotes) {
            warning = {
              type: 'branch-publish-failed',
              branch: taskBranch,
              remote: 'unknown',
              error: { type: 'error', message: configuredRemotes.error },
            };
            break;
          }
          const publishResult = await project.repository.publishBranch(taskBranch, pushRemote);
          if (!publishResult.success) {
            warning = {
              type: 'branch-publish-failed',
              branch: taskBranch,
              remote: pushRemote,
              error: publishResult.error,
            };
          }
        }
      } else {
        // Check out the PR head branch directly — taskBranch === sourceBranch signals
        // the provider to use checkoutExistingBranch (local branch now exists from fetchPrForReview).
        taskBranch = strategy.headBranch;
      }
      break;
    }

    case 'no-worktree': {
      // taskBranch remains undefined → provider uses the project root directory.
      break;
    }
  }

  const initialStatus: TaskLifecycleStatus = params.initialStatus ?? 'in_progress';

  const [taskRow] = await db
    .insert(tasks)
    .values({
      id: params.id,
      projectId: params.projectId,
      name: params.name,
      taskBranch,
      status: initialStatus,
      sourceBranch: toStoredBranch(dbSourceBranch),
      linkedIssue: params.linkedIssue ? JSON.stringify(params.linkedIssue) : null,
      workspaceProvider: params.workspaceProvider ?? null,
      updatedAt: sql`CURRENT_TIMESTAMP`,
      statusChangedAt: sql`CURRENT_TIMESTAMP`,
      lastInteractedAt: sql`CURRENT_TIMESTAMP`,
    })
    .returning();

  let prs: Awaited<ReturnType<typeof prQueryService.getTaskPullRequests>> = [];
  if (strategy.kind === 'from-pull-request') {
    const capability = await providerRepositoryService.resolveProject(params.projectId);
    if (capability.success) {
      prs = await prQueryService.getTaskPullRequests(
        params.projectId,
        strategy.headBranch,
        capability.data.repositoryUrl
      );
    }
  }

  const task = { ...mapTaskRowToTask(taskRow, prs), automationId: params.automationId };

  const workspaceType = ((): 'local' | 'project-ssh' | 'byoi' => {
    if (params.workspaceProvider === 'byoi') return 'byoi';
    if (project.defaultWorkspaceType.kind === 'ssh') return 'project-ssh';
    return 'local';
  })();
  const workspaceId = crypto.randomUUID();
  await db.insert(workspaces).values({ id: workspaceId, type: workspaceType });
  await db.update(tasks).set({ workspaceId }).where(eq(tasks.id, params.id));

  return ok({ task: { ...task, workspaceId }, warning });
}
