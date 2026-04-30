import { randomUUID } from 'node:crypto';
import type { TaskCreateAction } from '@shared/automations/actions';
import { makePtySessionId } from '@shared/ptySessionId';
import { err, ok } from '@shared/result';
import type { CreateTaskError } from '@shared/tasks';
import { appSettingsService } from '@main/core/settings/settings-service';
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

export const executeTaskCreate: ActionExecutor<TaskCreateAction> = async (action, ctx) => {
  const prompt = appendAutomationEventContext(
    applyAutomationTemplate(action.prompt, ctx.event),
    ctx.event
  ).trim();
  if (!prompt) return err('task_create_prompt_empty');

  if (!action.taskName) return err('task_create_missing_task_name');
  if (!action.sourceBranch) return err('task_create_missing_source_branch');
  if (!action.strategy) return err('task_create_missing_strategy');

  try {
    const taskId = randomUUID();
    const conversationId = randomUUID();
    const provider = action.provider ?? (await appSettingsService.get('defaultAgent'));
    const projectId = ctx.automation.projectId;

    const result = await createTask({
      id: taskId,
      projectId,
      name: action.taskName,
      sourceBranch: action.sourceBranch,
      strategy: action.strategy,
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
