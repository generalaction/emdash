import { randomUUID } from 'node:crypto';
import { createConversation } from '@main/core/conversations/createConversation';
import { openProject } from '@main/core/projects/operations/openProject';
import { projectManager } from '@main/core/projects/project-manager';
import { DEFAULT_AGENT_ID } from '@main/core/settings/settings-registry';
import { appSettingsService } from '@main/core/settings/settings-service';
import { generateTaskName } from '@main/core/tasks/name-generation/generateTaskName';
import type { ProvisionTaskError } from '@main/core/tasks/provision-task-error';
import { taskService } from '@main/core/tasks/task-service';
import {
  formatProvisionWorkspaceError,
  type ProvisionWorkspaceError,
} from '@main/core/workspaces/workspace-bootstrap-service';
import { resolveAutomationAgentAutoApprove } from '@shared/agent-auto-approve-defaults';
import type { TaskCreateAction } from '@shared/automations/actions';
import type { Branch } from '@shared/git';
import { bareRefName } from '@shared/git-utils';
import { err, ok, type Result } from '@shared/result';
import type { CreateTaskError, CreateTaskParams, GitSetup, WorkspaceLocation } from '@shared/tasks';
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

function formatProvisionActionError(error: ProvisionWorkspaceError | ProvisionTaskError): string {
  if (error.type === 'no-intent' || error.type === 'setup-failed') {
    return formatProvisionWorkspaceError(error);
  }
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
  project: NonNullable<ReturnType<typeof projectManager.getProject>>,
  taskName: string
): Promise<{ gitSetup: GitSetup; workspaceLocation: WorkspaceLocation }> {
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

  return { gitSetup, workspaceLocation };
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

function scopeGitSetupToRun(gitSetup: GitSetup, runId: string): GitSetup {
  if (gitSetup.kind === 'create-branch')
    return { ...gitSetup, branchName: makeRunBranchName(gitSetup.branchName, runId) };
  if (gitSetup.kind === 'pr-branch' && gitSetup.taskBranch)
    return { ...gitSetup, taskBranch: makeRunBranchName(gitSetup.taskBranch, runId) };
  return gitSetup;
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
    const storedConfig = ctx.automation.taskConfig as CreateTaskParams | null | undefined;
    const taskId = randomUUID();
    const conversationId = randomUUID();
    const taskName = makeRunTaskName(storedConfig, ctx);

    const projectResult = await ensureProjectOpen(projectId);
    if (!projectResult.success) return err({ message: projectResult.error });
    const project = projectResult.data;

    // Resolve git setup and workspace location from stored config or project defaults.
    let gitSetup: GitSetup;
    let workspaceLocation: WorkspaceLocation;
    if (storedConfig) {
      gitSetup = scopeGitSetupToRun(storedConfig.gitSetup, ctx.run.id);
      workspaceLocation = storedConfig.workspaceLocation;
    } else {
      ({ gitSetup, workspaceLocation } = await resolveProjectDefaults(project, taskName));
    }

    const provider =
      storedConfig?.initialConversation?.provider ??
      (await appSettingsService.get('defaultAgent')) ??
      DEFAULT_AGENT_ID;

    const initialConversation = {
      ...(storedConfig?.initialConversation ?? {}),
      id: conversationId,
      projectId,
      taskId,
      provider,
      title: storedConfig?.initialConversation?.title ?? ctx.automation.name,
      autoApprove: resolveAutomationAgentAutoApprove(
        provider,
        storedConfig?.initialConversation?.autoApprove
      ),
      initialPrompt: prompt,
    };

    const taskConfig: CreateTaskParams = {
      ...storedConfig,
      id: taskId,
      projectId,
      name: taskName,
      gitSetup,
      workspaceLocation,
      automationId: ctx.automation.id,
      initialConversation,
    };

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
      const provision = await taskService.launch(taskId);
      if (!provision.success) {
        return err({ message: formatProvisionActionError(provision.error), taskId });
      }

      await createConversation({ ...initialConversation, isInitialConversation: true });
    } catch (error) {
      return err({ message: error instanceof Error ? error.message : String(error), taskId });
    }

    return ok({ taskId });
  } catch (error) {
    return err({ message: error instanceof Error ? error.message : String(error) });
  }
}
