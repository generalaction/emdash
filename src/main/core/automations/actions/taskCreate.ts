import { randomUUID } from 'node:crypto';
import type { TaskCreateAction } from '@shared/automations/actions';
import { makePtySessionId } from '@shared/ptySessionId';
import { err, ok } from '@shared/result';
import { type CreateTaskError } from '@shared/tasks';
import { projectManager } from '@main/core/projects/project-manager';
import { appSettingsService } from '@main/core/settings/settings-service';
import { createTask } from '@main/core/tasks/createTask';
import { generateTaskName } from '@main/core/tasks/generateTaskName';
import { applyTemplate } from './template';
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
  }
}

async function sourceBranchForAutomation(projectId: string) {
  const openResult = await projectManager.openProjectById(projectId);
  if (!openResult.success) {
    const message =
      openResult.error.type === 'path-not-found'
        ? `path_not_found:${openResult.error.path}`
        : openResult.error.type === 'ssh-disconnected'
          ? `ssh_disconnected:${openResult.error.connectionId}`
          : openResult.error.message;
    throw new Error(message);
  }

  const project = projectManager.getProject(projectId);
  if (!project) throw new Error('project_not_open');

  const [repoInfo, defaultBranch] = await Promise.all([
    project.repository.getRepositoryInfo(),
    project.repository.getDefaultBranchName().catch(() => 'main'),
  ]);

  return { type: 'local' as const, branch: repoInfo.currentBranch ?? defaultBranch };
}

export const executeTaskCreate: ActionExecutor<TaskCreateAction> = async (action, ctx) => {
  const prompt = applyTemplate(action.prompt, ctx.event).trim();
  if (!prompt) return err('task_create_prompt_empty');

  try {
    const taskId = randomUUID();
    const conversationId = randomUUID();
    const provider = action.provider ?? (await appSettingsService.get('defaultAgent'));
    const sourceBranch = await sourceBranchForAutomation(ctx.automation.projectId);
    const mode = action.mode ?? 'direct';
    const taskName =
      mode === 'worktree'
        ? generateTaskName({ title: `${ctx.automation.name} ${taskId.slice(0, 8)}` })
        : `Automation: ${ctx.automation.name}`;

    const result = await createTask({
      id: taskId,
      projectId: ctx.automation.projectId,
      name: taskName,
      sourceBranch,
      strategy:
        mode === 'worktree'
          ? { kind: 'new-branch', taskBranch: taskName }
          : { kind: 'no-worktree' },
      initialConversation: {
        id: conversationId,
        projectId: ctx.automation.projectId,
        taskId,
        provider,
        title: ctx.automation.name,
        initialPrompt: prompt,
      },
    });

    if (!result.success) return err(stringifyCreateTaskError(result.error));

    return ok({
      taskId,
      sessionId: makePtySessionId(ctx.automation.projectId, taskId, conversationId),
    });
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }
};
