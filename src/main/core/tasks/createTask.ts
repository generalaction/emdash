import { eq, sql } from 'drizzle-orm';
import { err, ok, Result } from '@shared/result';
import type { CreateTaskError, CreateTaskParams, Task } from '@shared/tasks';
import { parseNameWithOwner } from '@main/core/github/services/utils';
import { projectManager } from '@main/core/projects/project-manager';
import {
  findPrForBranch,
  linkTaskToPr,
  resolveInitialStatus,
} from '@main/core/task-status/pr-task-bridge';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import { createConversation } from '../conversations/createConversation';
import type { ProvisionTaskError } from '../projects/project-provider';
import { appSettingsService } from '../settings/settings-service';

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
  const remote = projectSettings.remote?.trim() || params.sourceBranch.remote?.trim() || 'origin';
  const remotes = await project.git.getRemotes();
  const canUseRemote = remotes.some((candidate) => candidate.name === remote);

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
        canUseRemote,
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

  let existingPrUrl: string | null = null;
  let initialStatus = params.initialStatus ?? 'in_progress';

  if (!params.initialStatus && taskBranch && nameWithOwner) {
    const existingPr = await findPrForBranch(taskBranch, nameWithOwner);
    if (existingPr) {
      existingPrUrl = existingPr.url;
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
    })
    .returning();

  // Write the tasks_pull_requests link now that the task row exists.
  if (existingPrUrl) {
    await linkTaskToPr(params.id, existingPrUrl);
  }

  const task: Task = {
    id: params.id,
    projectId: params.projectId,
    name: params.name,
    status: initialStatus,
    sourceBranch: dbSourceBranch,
    taskBranch,
    linkedIssue: params.linkedIssue ?? undefined,
    createdAt: taskRow.createdAt,
    updatedAt: taskRow.updatedAt,
    statusChangedAt: taskRow.statusChangedAt,
    isPinned: taskRow.isPinned === 1,
  };

  const provisionResult = await project.provisionTask(task, [], []);
  if (!provisionResult.success) {
    return err(mapProvisionError(provisionResult.error));
  }

  const lastInteractedAt = new Date().toISOString();
  await db
    .update(tasks)
    .set({ lastInteractedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(tasks.id, params.id));

  if (params.initialConversation) {
    await createConversation({
      ...params.initialConversation,
      autoApprove: params.initialConversation.autoApprove ?? taskSettings.autoApproveByDefault,
    });
  }

  return ok({ ...task, lastInteractedAt });
}
