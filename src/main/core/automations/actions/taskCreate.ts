import { randomUUID } from 'node:crypto';
import type { TaskCreateAction } from '@shared/automations/actions';
import { makePtySessionId } from '@shared/ptySessionId';
import { err, ok } from '@shared/result';
import type { CreateTaskError } from '@shared/tasks';
import { projectManager } from '@main/core/projects/project-manager';
import { appSettingsService } from '@main/core/settings/settings-service';
import { generateTaskName } from '@main/core/tasks/name-generation/generateTaskName';
import { createTask } from '@main/core/tasks/operations/createTask';
import { appendAutomationEventContext } from './eventContext';
import { applyAutomationTemplate } from './template';
import type { ActionExecutor } from './types';

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

async function resolveSourceBranch(projectId: string, taskName: string, action: TaskCreateAction) {
  if (action.sourceBranch && action.strategy) {
    return ok({ sourceBranch: action.sourceBranch, strategy: action.strategy });
  }

  const project = projectManager.getProject(projectId);
  if (!project) return err('project_not_found');

  const [branchesPayload, repoInfo] = await Promise.all([
    project.repository.getBranchesPayload(),
    project.repository.getRepositoryInfo(),
  ]);
  const defaultBranchName = await project.repository.getDefaultBranchName();
  const configuredRemote = await project.repository.getConfiguredRemote();
  const localDefault = branchesPayload.branches.find(
    (branch) => branch.type === 'local' && branch.branch === defaultBranchName
  );
  const remoteDefault = branchesPayload.branches.find(
    (branch) =>
      branch.type === 'remote' &&
      branch.branch === defaultBranchName &&
      branch.remote.name === configuredRemote
  );
  const currentBranch = repoInfo.currentBranch
    ? { type: 'local' as const, branch: repoInfo.currentBranch }
    : undefined;
  const sourceBranch = action.sourceBranch ??
    localDefault ??
    remoteDefault ??
    currentBranch ?? { type: 'local' as const, branch: defaultBranchName };
  const strategy =
    action.strategy ??
    (repoInfo.isUnborn
      ? { kind: 'no-worktree' as const }
      : {
          kind: 'new-branch' as const,
          taskBranch: taskName,
          pushBranch: true,
        });

  return ok({ sourceBranch, strategy });
}

export const executeTaskCreate: ActionExecutor<TaskCreateAction> = async (action, ctx) => {
  const prompt = appendAutomationEventContext(
    applyAutomationTemplate(action.prompt, ctx.event),
    ctx.event
  ).trim();
  if (!prompt) return err('task_create_prompt_empty');

  const taskName = action.taskName?.trim() || generateTaskName({ title: ctx.automation.name });
  const branchConfig = await resolveSourceBranch(ctx.automation.projectId, taskName, action);
  if (!branchConfig.success) return err(branchConfig.error);

  try {
    const taskId = randomUUID();
    const conversationId = randomUUID();
    const provider = action.provider ?? (await appSettingsService.get('defaultAgent'));
    const projectId = ctx.automation.projectId;

    const result = await createTask({
      id: taskId,
      projectId,
      name: taskName,
      sourceBranch: branchConfig.data.sourceBranch,
      strategy: branchConfig.data.strategy,
      linkedIssue: action.linkedIssue,
      initialConversation: {
        id: conversationId,
        projectId,
        taskId,
        provider,
        title: ctx.automation.name,
        initialPrompt: prompt,
        autoApprove: true,
      },
    });

    if (!result.success) return err(stringifyCreateTaskError(result.error));

    return ok({
      taskId,
      sessionId: makePtySessionId(projectId, taskId, conversationId),
    });
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }
};
