import { sql } from 'drizzle-orm';
import { resolveAgentAutoApprove } from '@shared/agent-auto-approve-defaults';
import { err, ok, type Result } from '@shared/result';
import type {
  CreateTaskError,
  CreateTaskParams,
  CreateTaskSuccess,
  CreateTaskWarning,
  TaskLifecycleStatus,
} from '@shared/tasks';
import { projectManager } from '@main/core/projects/project-manager';
import { taskEvents } from '@main/core/tasks/task-events';
import { taskManager } from '@main/core/tasks/task-manager';
import { db } from '@main/db/client';
import { tasks } from '@main/db/schema';
import { telemetryService } from '@main/lib/telemetry';
import { createConversation } from '../../conversations/createConversation';
import { prQueryService } from '../../pull-requests/pr-query-service';
import { appSettingsService } from '../../settings/settings-service';
import type { ProvisionTaskError } from '../provision-task-error';
import { resolveTaskBranchName } from '../resolveTaskBranchName';
import { toStoredBranch } from '../stored-branch';
import { mapTaskRowToTask } from '../utils/utils';

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
    case 'timeout':
      return { type: 'provision-timeout', timeoutMs: error.timeout, step: error.step };
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
  const agentAutoApproveDefaults = await appSettingsService.get('agentAutoApproveDefaults');
  let warning: CreateTaskWarning | undefined;

  const project = projectManager.getProject(params.projectId);
  if (!project) {
    return err({ type: 'project-not-found' });
  }
  const [, configuredRemote] = await Promise.all([
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
      // If the head branch is already checked out in a valid worktree, skip the fetch.
      // Git refuses to update a branch that is currently checked out, even with --force.
      const existingWorktree = await project.getWorktreeForBranch(strategy.headBranch);

      if (!existingWorktree) {
        // Fetch the PR head — handles same-repo and fork PRs.
        // Uses headRefName directly as the local branch name (same as `gh pr checkout`).
        const fetchResult = await project.repository.fetchPrForReview(
          strategy.prNumber,
          strategy.headBranch,
          strategy.headRepositoryUrl,
          strategy.headBranch,
          strategy.isFork,
          configuredRemote
        );
        if (!fetchResult.success) {
          return err({
            type: 'pr-fetch-failed',
            error: fetchResult.error,
            remote: configuredRemote,
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
    const capability = await prQueryService.getProjectRemoteInfo(params.projectId);
    if (capability.status === 'ready') {
      prs = await prQueryService.getTaskPullRequests(
        params.projectId,
        strategy.headBranch,
        capability.repositoryUrl
      );
    }
  }

  const task = mapTaskRowToTask(taskRow, prs);

  taskEvents._emit('task:created', task);

  const provisionResult = await taskManager.provisionTask(project, task, [], []);
  if (!provisionResult.success) {
    return err(mapProvisionError(provisionResult.error));
  }
  telemetryService.capture('task_provisioned', {
    project_id: params.projectId,
    task_id: params.id,
  });

  if (params.initialConversation) {
    await createConversation({
      ...params.initialConversation,
      autoApprove: resolveAgentAutoApprove(
        params.initialConversation.autoApprove,
        agentAutoApproveDefaults,
        params.initialConversation.provider
      ),
    });
  }

  const taskCreatedStrategy = (() => {
    if (strategy.kind === 'from-pull-request') return 'pr';
    if (params.linkedIssue) return 'issue';
    if (strategy.kind === 'no-worktree') return 'blank';
    return 'branch';
  })();

  telemetryService.capture('task_created', {
    strategy: taskCreatedStrategy,
    has_initial_prompt: Boolean(params.initialConversation?.initialPrompt?.trim()),
    has_issue: params.linkedIssue?.provider ?? 'none',
    provider: params.initialConversation?.provider ?? null,
    project_id: params.projectId,
    task_id: params.id,
  });
  if (params.linkedIssue) {
    telemetryService.capture('issue_linked_to_task', {
      provider: params.linkedIssue.provider,
      project_id: params.projectId,
      task_id: params.id,
    });
  }

  return ok({ task, warning });
}
