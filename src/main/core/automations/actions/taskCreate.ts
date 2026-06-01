import { randomUUID } from 'node:crypto';
import { createConversation } from '@main/core/conversations/createConversation';
import { openProject } from '@main/core/projects/operations/openProject';
import { projectManager } from '@main/core/projects/project-manager';
import { DEFAULT_AGENT_ID } from '@main/core/settings/settings-registry';
import { appSettingsService } from '@main/core/settings/settings-service';
import { generateTaskName } from '@main/core/tasks/name-generation/generateTaskName';
import type { ProvisionTaskError } from '@main/core/tasks/provision-task-error';
import { taskService } from '@main/core/tasks/task-service';
import { resolveAutomationAgentAutoApprove } from '@shared/agent-auto-approve-defaults';
import type { TaskCreateAction } from '@shared/automations/actions';
import type { Branch } from '@shared/git';
import { bareRefName } from '@shared/git-utils';
import { err, ok, type Result } from '@shared/result';
import type {
  CreateTaskError,
  CreateTaskParams,
  CreateTaskStrategy,
  GitSetup,
  WorkspaceLocation,
} from '@shared/tasks';
import { linkRunTask } from '../run-transitions';
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

async function resolveProjectDefaults(
  projectId: string,
  taskName: string
): Promise<Result<{ gitSetup: GitSetup; workspaceLocation: WorkspaceLocation }, string>> {
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
    (branch: Branch) => branch.type === 'local' && branch.branch === defaultBranchName
  );
  const remoteDefault = branchesPayload.branches.find(
    (branch: Branch) =>
      branch.type === 'remote' &&
      branch.branch === defaultBranchName &&
      branch.remote.name === configuredRemotes.baseRemote
  );
  const currentBranch = repoInfo.currentBranch
    ? { type: 'local' as const, branch: repoInfo.currentBranch }
    : undefined;
  const fromBranch: Branch = localDefault ??
    remoteDefault ??
    currentBranch ?? { type: 'local' as const, branch: defaultBranchName };

  const gitSetup: GitSetup = repoInfo.isUnborn
    ? { kind: 'none' }
    : { kind: 'create-branch', branchName: taskName, fromBranch, pushBranch: true };

  const workspaceLocation: WorkspaceLocation =
    project.defaultWorkspaceType.kind === 'ssh' ? { host: 'project-ssh' } : { host: 'local' };

  return ok({ gitSetup, workspaceLocation });
}

function makeRunTaskName(storedConfig: CreateTaskParams | null | undefined, ctx: ActionContext) {
  return generateTaskName({
    title: storedConfig?.name?.trim() || ctx.automation.name,
    description: ctx.run.id,
  });
}

function makeRunBranchName(baseBranch: string, runId: string) {
  return generateTaskName({ title: baseBranch, description: runId });
}

/**
 * Legacy stored configs (before the gitSetup migration) have `strategy` and `sourceBranch`.
 * This helper normalises them to a `GitSetup` value.
 */
type LegacyStoredConfig = CreateTaskParams & {
  strategy?: CreateTaskStrategy;
  sourceBranch?: Branch;
  workspaceProvider?: 'byoi';
};

function gitSetupFromConfig(config: LegacyStoredConfig): GitSetup {
  // New format: gitSetup is always present (cast needed because old runtime data may omit it).
  const gitSetup = config.gitSetup as GitSetup | undefined;
  if (gitSetup) return gitSetup;

  // Legacy format: convert strategy → GitSetup.
  const { strategy, sourceBranch } = config;
  if (!strategy) return { kind: 'none' };

  switch (strategy.kind) {
    case 'new-branch':
      return {
        kind: 'create-branch',
        branchName: strategy.taskBranch,
        fromBranch: sourceBranch ?? { type: 'local', branch: 'main' },
        pushBranch: strategy.pushBranch,
      };
    case 'checkout-existing':
      return { kind: 'use-branch', branchName: sourceBranch?.branch ?? 'main' };
    case 'from-pull-request':
      return {
        kind: 'pr-branch',
        prNumber: strategy.prNumber,
        headBranch: strategy.headBranch,
        headRepositoryUrl: strategy.headRepositoryUrl,
        isFork: strategy.isFork,
        taskBranch: strategy.taskBranch,
        pushBranch: strategy.pushBranch,
      };
    case 'no-worktree':
      return { kind: 'none' };
  }
}

function workspaceLocationFromConfig(config: LegacyStoredConfig): WorkspaceLocation {
  // New format
  const loc = config.workspaceLocation as WorkspaceLocation | undefined;
  if (loc) return loc;
  // Legacy format
  return config.workspaceProvider === 'byoi' ? { host: 'byoi' } : { host: 'local' };
}

async function resolveRunScopedGitSetup(
  config: LegacyStoredConfig,
  projectId: string,
  taskName: string,
  runId: string
): Promise<Result<{ gitSetup: GitSetup; workspaceLocation: WorkspaceLocation }, string>> {
  const gitSetup = gitSetupFromConfig(config);
  const workspaceLocation = workspaceLocationFromConfig(config);

  if (gitSetup.kind === 'create-branch') {
    return ok({
      gitSetup: { ...gitSetup, branchName: makeRunBranchName(gitSetup.branchName, runId) },
      workspaceLocation,
    });
  }

  if (gitSetup.kind === 'pr-branch' && gitSetup.taskBranch) {
    return ok({
      gitSetup: { ...gitSetup, taskBranch: makeRunBranchName(gitSetup.taskBranch, runId) },
      workspaceLocation,
    });
  }

  // Upgrade `none` → `create-branch` for non-BYOI repos that are no longer unborn.
  if (gitSetup.kind === 'none' && workspaceLocation.host !== 'byoi') {
    const defaults = await resolveProjectDefaults(projectId, taskName);
    if (!defaults.success) return err(defaults.error);
    const defaultGitSetup = defaults.data.gitSetup;
    if (defaultGitSetup.kind === 'create-branch') {
      return ok({
        gitSetup: { ...defaultGitSetup, pushBranch: false },
        workspaceLocation,
      });
    }
    // Repo is still unborn per defaults → keep none.
  }

  return ok({ gitSetup, workspaceLocation });
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
    const storedConfig = ctx.automation.taskConfig as LegacyStoredConfig | null | undefined;
    const taskId = randomUUID();
    const conversationId = randomUUID();
    const taskName = makeRunTaskName(storedConfig, ctx);

    let taskConfig: CreateTaskParams;
    if (storedConfig?.initialConversation) {
      const projectResult = await ensureProjectOpen(projectId);
      if (!projectResult.success) return err({ message: projectResult.error });
      const resolved = await resolveRunScopedGitSetup(
        storedConfig,
        projectId,
        taskName,
        ctx.run.id
      );
      if (!resolved.success) return err({ message: resolved.error });

      taskConfig = {
        ...storedConfig,
        id: taskId,
        projectId,
        name: taskName,
        gitSetup: resolved.data.gitSetup,
        workspaceLocation: resolved.data.workspaceLocation,
        automationId: ctx.automation.id,
        initialConversation: {
          ...storedConfig.initialConversation,
          id: conversationId,
          projectId,
          taskId,
          autoApprove: resolveAutomationAgentAutoApprove(
            storedConfig.initialConversation.provider,
            storedConfig.initialConversation.autoApprove
          ),
          initialPrompt: prompt,
        },
      };
    } else {
      const defaults = await resolveProjectDefaults(projectId, taskName);
      if (!defaults.success) return err({ message: defaults.error });
      const provider = (await appSettingsService.get('defaultAgent')) ?? DEFAULT_AGENT_ID;
      const resolved = storedConfig
        ? await resolveRunScopedGitSetup(storedConfig, projectId, taskName, ctx.run.id)
        : ok(defaults.data);
      if (!resolved.success) return err({ message: resolved.error });

      taskConfig = {
        ...storedConfig,
        id: taskId,
        projectId,
        name: taskName,
        gitSetup: resolved.data.gitSetup,
        workspaceLocation: resolved.data.workspaceLocation,
        automationId: ctx.automation.id,
        initialConversation: {
          id: conversationId,
          projectId,
          taskId,
          provider,
          title: ctx.automation.name,
          autoApprove: resolveAutomationAgentAutoApprove(
            provider,
            storedConfig?.initialConversation?.autoApprove
          ),
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
    try {
      await linkRunTask(ctx.run.id, taskId);
    } catch (error) {
      return err({ message: error instanceof Error ? error.message : String(error), taskId });
    }

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

    return ok({ taskId });
  } catch (error) {
    return err({ message: error instanceof Error ? error.message : String(error) });
  }
}
