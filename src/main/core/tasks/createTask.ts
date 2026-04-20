import { and, eq, sql } from 'drizzle-orm';
import { err, ok, Result } from '@shared/result';
import type {
  CreateTaskError,
  CreateTaskParams,
  CreateTaskSuccess,
  CreateTaskWarning,
  Task,
} from '@shared/tasks';
import { parseNameWithOwner } from '@main/core/github/services/utils';
import { projectManager } from '@main/core/projects/project-manager';
import { findPrForBranch, resolveInitialStatus } from '@main/core/task-status/pr-task-bridge';
import { db } from '@main/db/client';
import { pullRequests, tasks, tasksPullRequests } from '@main/db/schema';
import { capture } from '@main/lib/telemetry';
import { createConversation } from '../conversations/createConversation';
import type { ProvisionTaskError } from '../projects/project-provider';
import { prRowToPullRequest } from '../pull-requests/pr-utils';
import { appSettingsService } from '../settings/settings-service';
import { mapTaskRowToTask } from './core';
import { resolveTaskBranchName } from './resolveTaskBranchName';
import { toStoredBranch } from './stored-branch';

function mapProvisionError(error: ProvisionTaskError): CreateTaskError {
  switch (error.type) {
    case 'branch-not-found':
      return { type: 'branch-not-found', branch: error.branch };
    case 'worktree-setup-failed':
      return {
        type: 'worktree-setup-failed',
        branch: error.branch,
        message: error.message,
      };
    default:
      return { type: 'provision-failed', message: error.message };
  }
}

export async function createTask(
  params: CreateTaskParams
): Promise<Result<CreateTaskSuccess, CreateTaskError>> {
  const { strategy } = params;
  const suffix = Math.random().toString(36).slice(2, 7);
  const branchPrefix = (await appSettingsService.get('localProject')).branchPrefix ?? '';
  const taskSettings = await appSettingsService.get('tasks');
  let warning: CreateTaskWarning | undefined;

  const project = projectManager.getProject(params.projectId);
  if (!project) {
    return err({ type: 'project-not-found' });
  }
  const [remotes, configuredRemote] = await Promise.all([
    project.repository.getRemotes(),
    project.repository.getConfiguredRemote(),
  ]);

  // Determines what gets stored as taskBranch in the DB and how the worktree is prepared.
  let taskBranch: string | undefined;
  // sourceBranch stored in the DB — defaults to params.sourceBranch but overridden for PRs.
  let dbSourceBranch = params.sourceBranch;

  switch (strategy.kind) {
    case 'new-branch': {
      const rawBranch = strategy.taskBranch;
      taskBranch = resolveTaskBranchName({
        rawBranch,
        branchPrefix,
        suffix,
        linkedIssue: params.linkedIssue,
      });
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
        return err({ type: 'branch-create-failed', branch: taskBranch, error: createResult.error });
      }
      if (strategy.pushBranch) {
        const publishResult = await project.repository.publishBranch(taskBranch, configuredRemote);
        if (!publishResult.success) {
          warning = {
            type: 'branch-publish-failed',
            branch: taskBranch,
            remote: configuredRemote,
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
      // Fetch via GitHub's PR ref — works for fork PRs and same-repo PRs alike.
      const fetchResult = await project.repository.fetchPrRef(
        strategy.prNumber,
        strategy.headBranch,
        configuredRemote
      );
      if (!fetchResult.success) {
        return err({ type: 'pr-fetch-failed', error: fetchResult.error, remote: configuredRemote });
      }

      dbSourceBranch = { type: 'local', branch: strategy.headBranch };

      if (strategy.taskBranch) {
        // Create a new task branch on top of the just-fetched local head branch.
        const rawBranch = strategy.taskBranch;
        taskBranch = resolveTaskBranchName({
          rawBranch,
          branchPrefix,
          suffix,
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
          const publishResult = await project.repository.publishBranch(
            taskBranch,
            configuredRemote
          );
          if (!publishResult.success) {
            warning = {
              type: 'branch-publish-failed',
              branch: taskBranch,
              remote: configuredRemote,
              error: publishResult.error,
            };
          }
        }
      } else {
        // Check out the PR head branch directly — taskBranch === sourceBranch signals
        // the provider to use checkoutExistingBranch (local branch now exists from fetchPrRef).
        taskBranch = strategy.headBranch;
      }
      break;
    }

    case 'no-worktree': {
      // taskBranch remains undefined → provider uses the project root directory.
      break;
    }
  }

  // If no explicit initialStatus was passed, check whether a PR already exists for
  // this branch in the DB cache and compute the right starting status from it.
  const remoteUrl = remotes.find((r) => r.name === configuredRemote)?.url;
  const nameWithOwner = remoteUrl ? parseNameWithOwner(remoteUrl) : null;

  let initialStatus = params.initialStatus ?? 'in_progress';

  if (!params.initialStatus && taskBranch && nameWithOwner) {
    const existingPr = await findPrForBranch(taskBranch, nameWithOwner);
    if (existingPr) {
      initialStatus = resolveInitialStatus(existingPr);
    }
  }

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
      updatedAt: sql`CURRENT_TIMESTAMP`,
      statusChangedAt: sql`CURRENT_TIMESTAMP`,
      lastInteractedAt: sql`CURRENT_TIMESTAMP`,
    })
    .returning();

  // Look up all PRs in the DB cache that match this task's branch, link them, and
  // include them in the returned task so the renderer has them from the start.
  let linkedPrs: Task['prs'] = [];
  if (taskBranch) {
    const conditions = nameWithOwner
      ? and(eq(pullRequests.headRefName, taskBranch), eq(pullRequests.nameWithOwner, nameWithOwner))
      : eq(pullRequests.headRefName, taskBranch);
    const prRows = await db.select().from(pullRequests).where(conditions);
    if (prRows.length > 0) {
      await db
        .insert(tasksPullRequests)
        .values(prRows.map((pr) => ({ taskId: params.id, pullRequestUrl: pr.url })))
        .onConflictDoNothing();
      linkedPrs = prRows.map(prRowToPullRequest);
    }
  }

  const task = mapTaskRowToTask(taskRow, linkedPrs);

  const provisionResult = await project.provisionTask(task, [], []);
  if (!provisionResult.success) {
    return err(mapProvisionError(provisionResult.error));
  }
  capture('task_provisioned', {
    project_id: params.projectId,
    task_id: params.id,
  });

  if (params.initialConversation) {
    await createConversation({
      ...params.initialConversation,
      autoApprove: params.initialConversation.autoApprove ?? taskSettings.autoApproveByDefault,
    });
  }

  const taskCreatedStrategy = (() => {
    if (strategy.kind === 'from-pull-request') return 'pr';
    if (params.linkedIssue) return 'issue';
    if (strategy.kind === 'no-worktree') return 'blank';
    return 'branch';
  })();

  capture('task_created', {
    strategy: taskCreatedStrategy,
    has_initial_prompt: Boolean(params.initialConversation?.initialPrompt?.trim()),
    has_issue: params.linkedIssue?.provider ?? 'none',
    provider: params.initialConversation?.provider ?? null,
    project_id: params.projectId,
    task_id: params.id,
  });
  if (params.linkedIssue) {
    capture('issue_linked_to_task', {
      provider: params.linkedIssue.provider,
      project_id: params.projectId,
      task_id: params.id,
    });
  }

  return ok({ task, warning });
}
