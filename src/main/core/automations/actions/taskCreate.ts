import { randomUUID } from 'node:crypto';
import { createConversation } from '@main/core/conversations/createConversation';
import { openProject } from '@main/core/projects/operations/openProject';
import { projectManager } from '@main/core/projects/project-manager';
import { DEFAULT_AGENT_ID } from '@main/core/settings/settings-registry';
import { appSettingsService } from '@main/core/settings/settings-service';
import { generateTaskName } from '@main/core/tasks/name-generation/generateTaskName';
import { taskService } from '@main/core/tasks/task-service';
import { resolveAutomationAgentAutoApprove } from '@shared/agent-auto-approve-defaults';
import type { TaskCreateAction } from '@shared/automations/actions';
import type { Branch } from '@shared/git';
import { bareRefName } from '@shared/git-utils';
import { err, ok, type Result } from '@shared/result';
import type {
  CreateTaskError,
  CreateTaskParams,
  GitSetup,
  ProvisionWorkspaceError,
  WorkspaceLocation,
} from '@shared/tasks';
import type { WorkspaceConfig } from '@shared/workspace-config';
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

function formatProvisionActionError(error: ProvisionWorkspaceError): string {
  switch (error.type) {
    case 'no-intent':
      return 'Workspace has no intent and no resolved path — cannot provision.';
    case 'setup-failed':
      return `Setup step '${error.stepKind}' failed (${error.stepErrorType})${error.message ? `: ${error.message}` : ''}.`;
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
): Promise<WorkspaceConfig> {
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

  const git: GitSetup = repoInfo.isUnborn
    ? { kind: 'none' }
    : { kind: 'create-branch', branchName: taskName, fromBranch, pushBranch: true };

  const workspace: WorkspaceLocation =
    project.defaultWorkspaceType.kind === 'ssh' ? { host: 'project-ssh' } : { host: 'local' };

  return { version: '1', git, workspace };
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

function scopeWorkspaceConfigToRun(config: WorkspaceConfig, runId: string): WorkspaceConfig {
  const git = config.git;
  if (git.kind === 'create-branch')
    return { ...config, git: { ...git, branchName: makeRunBranchName(git.branchName, runId) } };
  if (git.kind === 'pr-branch' && git.taskBranch)
    return {
      ...config,
      git: { ...git, taskBranch: makeRunBranchName(git.taskBranch, runId) },
    };
  return config;
}

/**
 * Resolves a WorkspaceConfig from a stored automation task config.
 * Handles backwards compat for old configs that stored gitSetup + workspaceLocation separately.
 */
function resolveStoredWorkspaceConfig(
  storedConfig:
    | (CreateTaskParams & { gitSetup?: GitSetup; workspaceLocation?: WorkspaceLocation })
    | null
    | undefined
): WorkspaceConfig | null {
  if (!storedConfig) return null;
  if (storedConfig.workspaceConfig) return storedConfig.workspaceConfig;
  // Backwards compat: old stored configs had gitSetup + workspaceLocation as top-level fields.
  const legacyGit = (storedConfig as { gitSetup?: GitSetup }).gitSetup;
  const legacyWorkspace = (storedConfig as { workspaceLocation?: WorkspaceLocation })
    .workspaceLocation;
  if (legacyGit && legacyWorkspace) {
    return { version: '1', git: legacyGit, workspace: legacyWorkspace };
  }
  return null;
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

    // Resolve workspace config from stored config or project defaults.
    let workspaceConfig: WorkspaceConfig;
    const storedWorkspaceConfig = resolveStoredWorkspaceConfig(storedConfig);
    if (storedWorkspaceConfig) {
      workspaceConfig = scopeWorkspaceConfigToRun(storedWorkspaceConfig, ctx.run.id);
    } else {
      workspaceConfig = await resolveProjectDefaults(project, taskName);
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
      workspaceConfig,
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
