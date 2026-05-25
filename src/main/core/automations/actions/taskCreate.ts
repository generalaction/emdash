import { randomUUID } from 'node:crypto';
import { createConversation } from '@main/core/conversations/createConversation';
import { openProject } from '@main/core/projects/operations/openProject';
import { projectManager } from '@main/core/projects/project-manager';
import { DEFAULT_AGENT_ID } from '@main/core/settings/settings-registry';
import { appSettingsService } from '@main/core/settings/settings-service';
import { generateTaskName } from '@main/core/tasks/name-generation/generateTaskName';
import type { ProvisionTaskError } from '@main/core/tasks/provision-task-error';
import { taskService } from '@main/core/tasks/task-service';
import type { TaskCreateAction } from '@shared/automations/actions';
import { bareRefName } from '@shared/git-utils';
import { makePtySessionId } from '@shared/ptySessionId';
import { err, ok, type Result } from '@shared/result';
import type { CreateTaskError, CreateTaskParams } from '@shared/tasks';
import { updateRun } from '../repo';
import type { ActionContext, ActionError, ActionOutcome } from './types';

function createTaskErrorLeavesTask(error: CreateTaskError): boolean {
  // Provisioning runs after createTask has inserted the task/workspace, so
  // automation callers can still link to the partially-created task.
  return error.type === 'provision-failed' || error.type === 'provision-timeout';
}

function formatCreateTaskActionError(error: CreateTaskError): string {
  switch (error.type) {
    case 'project-not-found':
      return 'project_not_found';
    case 'initial-commit-required':
      return `initial_commit_required:${error.branch}`;
    case 'branch-create-failed':
      return `branch_create_failed:${error.branch}`;
    case 'pr-fetch-failed':
      return `pr_fetch_failed:${error.remote}`;
    case 'branch-not-found':
      return `branch_not_found:${error.branch}`;
    case 'worktree-setup-failed':
      return error.message ?? `worktree_setup_failed:${error.branch}`;
    case 'provision-failed':
      return error.message;
    case 'provision-timeout':
      return `provisioning timed out after ${error.timeoutMs}ms at step ${error.step ?? 'unknown'}`;
  }
}

function formatProvisionActionError(error: ProvisionTaskError): string {
  switch (error.type) {
    case 'timeout':
      return error.step ? `${error.message} (step: ${error.step})` : error.message;
    case 'error':
      return error.message;
    case 'branch-not-found':
      return `Branch "${error.branch}" was not found locally or on remote`;
    case 'worktree-setup-failed':
      return error.message
        ? `Failed to set up worktree for branch "${error.branch}": ${error.message}`
        : `Failed to set up worktree for branch "${error.branch}"`;
  }
}

async function ensureProjectOpen(projectId: string) {
  let project = projectManager.getProject(projectId);
  if (!project) {
    const openResult = await openProject(projectId);
    if (!openResult.success) return err('project_not_found');
    project = projectManager.getProject(projectId);
    if (!project) return err('project_not_found');
  }

  return ok(project);
}

async function resolveProjectDefaults(projectId: string, taskName: string) {
  const projectResult = await ensureProjectOpen(projectId);
  if (!projectResult.success) return projectResult;
  const project = projectResult.data;

  const [branchesPayload, repoInfo, configuredRemotes] = await Promise.all([
    project.repository.getBranchesPayload(),
    project.repository.getRepositoryInfo(),
    project.repository.getConfiguredRemotes(),
  ]);
  const defaultBranchName = bareRefName(branchesPayload.gitDefaultBranch);
  const localDefault = branchesPayload.branches.find(
    (branch) => branch.type === 'local' && branch.branch === defaultBranchName
  );
  const remoteDefault = branchesPayload.branches.find(
    (branch) =>
      branch.type === 'remote' &&
      branch.branch === defaultBranchName &&
      branch.remote.name === configuredRemotes.baseRemote
  );
  const currentBranch = repoInfo.currentBranch
    ? { type: 'local' as const, branch: repoInfo.currentBranch }
    : undefined;
  const sourceBranch = localDefault ??
    remoteDefault ??
    currentBranch ?? { type: 'local' as const, branch: defaultBranchName };
  const strategy = repoInfo.isUnborn
    ? { kind: 'no-worktree' as const }
    : { kind: 'new-branch' as const, taskBranch: taskName, pushBranch: true };

  return ok({ sourceBranch, strategy });
}

export async function executeTaskCreate(
  action: TaskCreateAction,
  ctx: ActionContext
): Promise<Result<ActionOutcome, ActionError>> {
  const prompt = action.prompt.trim();
  if (!prompt) return err({ message: 'task_create_prompt_empty' });

  const projectId = ctx.automation.projectId;
  if (!projectId) return err({ message: 'no_project_attached' });

  try {
    const storedConfig = ctx.automation.taskConfig;
    const taskId = randomUUID();
    const conversationId = randomUUID();

    let taskConfig: CreateTaskParams;
    if (storedConfig?.initialConversation) {
      const projectResult = await ensureProjectOpen(projectId);
      if (!projectResult.success) return err({ message: projectResult.error });

      taskConfig = {
        ...storedConfig,
        id: taskId,
        projectId,
        automationId: ctx.automation.id,
        initialConversation: {
          ...storedConfig.initialConversation,
          id: conversationId,
          projectId,
          taskId,
          initialPrompt: prompt,
        },
      };
    } else {
      const taskName = generateTaskName({ title: ctx.automation.name, description: ctx.run?.id });
      const defaults = await resolveProjectDefaults(projectId, taskName);
      if (!defaults.success) return err({ message: defaults.error });
      const provider = (await appSettingsService.get('defaultAgent')) ?? DEFAULT_AGENT_ID;
      taskConfig = {
        ...storedConfig,
        id: taskId,
        projectId,
        name: storedConfig?.name?.trim() || taskName,
        sourceBranch: storedConfig?.sourceBranch ?? defaults.data.sourceBranch,
        strategy: storedConfig?.strategy ?? defaults.data.strategy,
        automationId: ctx.automation.id,
        initialConversation: {
          id: conversationId,
          projectId,
          taskId,
          provider,
          title: ctx.automation.name,
          initialPrompt: prompt,
        },
      };
    }

    const result = await taskService.createTask(taskConfig);
    if (!result.success) {
      return err({
        message: formatCreateTaskActionError(result.error),
        taskId: createTaskErrorLeavesTask(result.error) ? taskId : undefined,
      });
    }
    if (ctx.run) await updateRun(ctx.run.id, { taskId, createdTaskId: taskId });

    try {
      const provision = await taskService.provision(taskId);
      if (!provision.success) {
        return err({ message: formatProvisionActionError(provision.error), taskId });
      }

      if (taskConfig.initialConversation) {
        await createConversation({
          ...taskConfig.initialConversation,
          isInitialConversation: true,
        });
      }
    } catch (error) {
      return err({ message: error instanceof Error ? error.message : String(error), taskId });
    }

    return ok({
      taskId,
      sessionId: makePtySessionId(projectId, taskId, conversationId),
    });
  } catch (error) {
    return err({ message: error instanceof Error ? error.message : String(error) });
  }
}
