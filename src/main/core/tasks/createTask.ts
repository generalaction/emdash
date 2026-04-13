import { and, eq, sql } from 'drizzle-orm';
import { err, ok, Result } from '@shared/result';
import type { CreateTaskError, CreateTaskParams, Task } from '@shared/tasks';
import { selectPreferredRemote } from '@main/core/git/remote-preference';
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

function mapProvisionError(error: ProvisionTaskError): CreateTaskError {
  const msg = error.message;
  const branchNotFoundMatch = /^Branch "(.+)" was not found locally or on remote$/.exec(msg);
  if (branchNotFoundMatch) {
    return { type: 'branch-not-found', branch: branchNotFoundMatch[1] };
  }
  if (msg.includes('Failed to set up worktree')) {
    return { type: 'worktree-setup-failed', message: msg };
  }
  return { type: 'provision-failed', message: msg };
}

export async function createTask(params: CreateTaskParams): Promise<Result<Task, CreateTaskError>> {
  const { strategy } = params;
  const suffix = Math.random().toString(36).slice(2, 7);
  const branchPrefix = (await appSettingsService.get('localProject')).branchPrefix ?? '';
  const taskSettings = await appSettingsService.get('tasks');

  const project = projectManager.getProject(params.projectId);
  if (!project) {
    return err({ type: 'project-not-found' });
  }
  const projectSettings = await project.settings.get();
  const sourceBranchRemote = params.sourceBranch.remote?.trim();
  const remotes = await project.git.getRemotes();
  const remote = selectPreferredRemote(projectSettings.remote, remotes);
  const canUseRemote = remotes.some((candidate) => candidate.name === remote);
  const canUseRemoteBase = canUseRemote && !!sourceBranchRemote;

  // Determines what gets stored as taskBranch in the DB and how the worktree is prepared.
  let taskBranch: string | undefined;
  // sourceBranch stored in the DB — defaults to params.sourceBranch.branch but overridden for PRs.
  let dbSourceBranch = params.sourceBranch.branch;

  switch (strategy.kind) {
    case 'new-branch': {
      const rawBranch = strategy.taskBranch;
      taskBranch = branchPrefix
        ? `${branchPrefix}/${rawBranch}-${suffix}`
        : `${rawBranch}-${suffix}`;
      const createResult = await project.git.createBranch(
        taskBranch,
        params.sourceBranch.branch,
        canUseRemoteBase,
        remote
      );
      if (!createResult.success) {
        switch (createResult.error.type) {
          case 'already_exists':
            return err({ type: 'branch-already-exists', branch: taskBranch });
          case 'invalid_base':
            return err({ type: 'invalid-base-branch', branch: params.sourceBranch.branch });
          default:
            return err({
              type: 'provision-failed',
              message: `Failed to create branch '${taskBranch}': ${createResult.error.type}`,
            });
        }
      }
      if (strategy.pushBranch) {
        await project.git.publishBranch(taskBranch, remote);
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
      const fetchResult = await project.git.fetchPrRef(
        strategy.prNumber,
        strategy.headBranch,
        remote
      );
      if (!fetchResult.success) {
        const msg =
          fetchResult.error.type === 'not_found'
            ? `PR #${fetchResult.error.prNumber} was not found on remote "${remote}"`
            : fetchResult.error.message;
        return err({ type: 'pr-fetch-failed', message: msg });
      }

      dbSourceBranch = strategy.headBranch;

      if (strategy.taskBranch) {
        // Create a new task branch on top of the just-fetched local head branch.
        const rawBranch = strategy.taskBranch;
        taskBranch = branchPrefix
          ? `${branchPrefix}/${rawBranch}-${suffix}`
          : `${rawBranch}-${suffix}`;
        const createResult = await project.git.createBranch(taskBranch, strategy.headBranch, false);
        if (!createResult.success) {
          switch (createResult.error.type) {
            case 'already_exists':
              return err({ type: 'branch-already-exists', branch: taskBranch });
            case 'invalid_base':
              return err({ type: 'invalid-base-branch', branch: strategy.headBranch });
            default:
              return err({
                type: 'provision-failed',
                message: `Failed to create branch '${taskBranch}': ${createResult.error.type}`,
              });
          }
        }
        if (strategy.pushBranch) {
          await project.git.publishBranch(taskBranch, remote);
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
  const remoteUrl = remotes.find((r) => r.name === remote)?.url;
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
      sourceBranch: dbSourceBranch,
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

  if (params.initialConversation) {
    await createConversation({
      ...params.initialConversation,
      autoApprove: params.initialConversation.autoApprove ?? taskSettings.autoApproveByDefault,
    });
  }

  capture('task_created', {
    has_initial_prompt: Boolean(params.initialConversation?.initialPrompt?.trim()),
    has_issue: params.linkedIssue?.provider ?? 'none',
    provider: params.initialConversation?.provider ?? null,
  });
  if (params.linkedIssue) {
    capture('issue_linked_to_task', { provider: params.linkedIssue.provider });
  }

  return ok(task);
}
