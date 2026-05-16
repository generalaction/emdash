import { randomUUID } from 'node:crypto';
import type { TaskCreateAction } from '@shared/automations/actions';
import { bareRefName } from '@shared/git-utils';
import { makePtySessionId } from '@shared/ptySessionId';
import { err, ok, type Result } from '@shared/result';
import type { CreateTaskError, CreateTaskParams } from '@shared/tasks';
import { openProject } from '@main/core/projects/operations/openProject';
import { projectManager } from '@main/core/projects/project-manager';
import { DEFAULT_AGENT_ID } from '@main/core/settings/settings-registry';
import { appSettingsService } from '@main/core/settings/settings-service';
import { generateTaskName } from '@main/core/tasks/name-generation/generateTaskName';
import { createTask } from '@main/core/tasks/operations/createTask';
import type { ActionContext, ActionError, ActionOutcome } from './types';

function taskExistsForCreateTaskError(error: CreateTaskError): boolean {
  return error.type === 'provision-failed' || error.type === 'provision-timeout';
}

function stringifyCreateTaskError(error: CreateTaskError): string {
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

async function resolveProjectDefaults(projectId: string, taskName: string) {
  let project = projectManager.getProject(projectId);
  if (!project) {
    const openResult = await openProject(projectId);
    if (!openResult.success) return err('project_not_found');
    project = projectManager.getProject(projectId);
    if (!project) return err('project_not_found');
  }

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
  const storedConfig = ctx.automation.taskConfig;
  const taskId = randomUUID();
  const conversationId = randomUUID();

  let taskConfig: CreateTaskParams;
  if (storedConfig?.initialConversation) {
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
        autoApprove: true,
      },
    };
  } else {
    const taskName = generateTaskName({ title: ctx.automation.name });
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
        autoApprove: true,
      },
    };
  }

  try {
    const result = await createTask(taskConfig);
    if (!result.success) {
      return err({
        message: stringifyCreateTaskError(result.error),
        taskId: taskExistsForCreateTaskError(result.error) ? taskId : undefined,
      });
    }
    return ok({
      taskId,
      sessionId: makePtySessionId(projectId, taskId, conversationId),
    });
  } catch (error) {
    return err({ message: error instanceof Error ? error.message : String(error) });
  }
}
