import { randomUUID } from 'node:crypto';
import { createConversation } from '@main/core/conversations/createConversation';
import { openProject } from '@main/core/projects/operations/openProject';
import { projectManager } from '@main/core/projects/project-manager';
import { DEFAULT_AGENT_ID } from '@main/core/settings/settings-registry';
import { appSettingsService } from '@main/core/settings/settings-service';
import { generateRandom } from '@main/core/tasks/name-generation/generateTaskName';
import {
  commitCreateTask,
  finalizeCreateTask,
  prepareCreateTask,
} from '@main/core/tasks/operations/createTask';
import { taskService } from '@main/core/tasks/task-service';
import { db } from '@main/db/client';
import type { ConversationRow, TaskRow } from '@main/db/schema';
import { resolveAutomationAgentAutoApprove } from '@shared/agent-auto-approve-defaults';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import type { Automation } from '@shared/automations/automation';
import type { AutomationRun } from '@shared/automations/automation-run';
import { err, ok, type Result } from '@shared/result';
import type { CreateTaskParams } from '@shared/tasks';
import type { WorkspaceConfig } from '@shared/workspace-config';
import {
  markRunCreatingConversation,
  markRunFailed,
  markRunLaunchingTask,
  type OnStepCompleted,
} from '../run-transitions';

async function ensureProjectOpen(projectId: string) {
  let project = projectManager.getProject(projectId);
  if (!project) {
    const openResult = await openProject(projectId);
    if (!openResult.success) return err('project_not_found' as const);
    project = projectManager.getProject(projectId);
    if (!project) return err('project_not_found' as const);
  }

  return ok(project);
}

function scopeWorkspaceConfigToRun(config: WorkspaceConfig, taskName: string): WorkspaceConfig {
  const git = config.git;
  if (git.kind === 'create-branch') return { ...config, git: { ...git, branchName: taskName } };
  if (git.kind === 'pr-branch' && git.taskBranch)
    return { ...config, git: { ...git, taskBranch: taskName } };
  return config;
}

export async function executeTaskCreate(
  automation: Automation,
  run: AutomationRun,
  onStepCompleted: OnStepCompleted
): Promise<Result<{ taskId: string }, string>> {
  const prompt = automation.conversationConfig?.prompt.trim();
  if (!prompt) return err('task_create_prompt_empty');

  const projectId = automation.projectId;
  if (!projectId) return err('no_project_attached');

  try {
    const taskConfig = automation.taskConfig;
    const taskId = randomUUID();
    const conversationId = randomUUID();
    const taskName = run.generatedTaskName ?? generateRandom();

    const projectResult = await ensureProjectOpen(projectId);
    if (!projectResult.success) {
      const failed = await markRunFailed(run.id, {
        step: 'create_task',
        code: 'project_not_found',
      });
      onStepCompleted(failed);
      return err(projectResult.error);
    }

    if (!taskConfig?.workspaceConfig) {
      const failed = await markRunFailed(run.id, {
        step: 'create_task',
        code: 'no_workspace_config',
      });
      onStepCompleted(failed);
      return err('no_workspace_config');
    }
    const workspaceConfig = scopeWorkspaceConfigToRun(taskConfig.workspaceConfig, taskName);

    const provider = (automation.conversationConfig?.provider ||
      (await appSettingsService.get('defaultAgent')) ||
      DEFAULT_AGENT_ID) as AgentProviderId;

    const createTaskParams: CreateTaskParams = {
      id: taskId,
      projectId,
      taskConfig: {
        version: '1',
        name: taskName,
        linkedIssue: taskConfig?.taskConfig.linkedIssue,
        initialStatus: taskConfig?.taskConfig.initialStatus,
      },
      workspaceConfig,
      automationRunId: run.id,
    };

    const prepared = await prepareCreateTask(createTaskParams);
    if (!prepared.success) {
      const error = prepared.error;
      let runError: Parameters<typeof markRunFailed>[1];
      switch (error.type) {
        case 'project-not-found':
          runError = { step: 'create_task', code: 'project_not_found' };
          break;
        case 'initial-commit-required':
          runError = {
            step: 'create_task',
            code: 'initial_commit_required',
            message: error.branch,
          };
          break;
        case 'branch-create-failed':
          runError = { step: 'create_task', code: 'branch_create_failed', message: error.branch };
          break;
        case 'pr-fetch-failed':
          runError = { step: 'create_task', code: 'pr_fetch_failed', message: error.remote };
          break;
        case 'branch-not-found':
          runError = { step: 'create_task', code: 'branch_not_found', message: error.branch };
          break;
        case 'worktree-setup-failed':
          runError = {
            step: 'create_task',
            code: 'worktree_setup_failed',
            message: error.branch ?? error.message,
          };
          break;
        case 'provision-failed':
          runError = { step: 'create_task', code: 'provision_failed', message: error.message };
          break;
        case 'provision-timeout':
          runError = {
            step: 'create_task',
            code: 'provision_timeout',
            message: String(error.timeoutMs),
          };
          break;
        default:
          runError = { step: 'create_task', code: 'unknown' };
      }
      const failed = await markRunFailed(run.id, runError);
      onStepCompleted(failed);
      return err(error.type);
    }

    let taskRow!: TaskRow;
    let convRow: ConversationRow | undefined;
    db.transaction((tx) => {
      ({ taskRow, convRow } = commitCreateTask(prepared.data, tx));
    });

    const createSuccess = finalizeCreateTask(prepared.data, taskRow, convRow);
    taskService.notifyTaskCreated(createSuccess.task, createTaskParams);

    const launching = await markRunLaunchingTask(run.id, Date.now());
    onStepCompleted(launching);

    try {
      const provision = await taskService.launch(taskId);
      if (!provision.success) {
        const msg = provision.error.type === 'setup-failed' ? provision.error.message : undefined;
        const failed = await markRunFailed(run.id, {
          step: 'launch_task',
          code: 'provision_failed',
          message: msg,
        });
        onStepCompleted(failed);
        return err('provision_failed');
      }

      const creatingConv = await markRunCreatingConversation(run.id, Date.now());
      onStepCompleted(creatingConv);

      await createConversation({
        id: conversationId,
        projectId,
        taskId,
        provider,
        title: automation.conversationConfig?.title ?? automation.name,
        autoApprove: resolveAutomationAgentAutoApprove(
          provider,
          automation.conversationConfig?.autoApprove
        ),
        initialPrompt: prompt,
        isInitialConversation: true,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const failed = await markRunFailed(run.id, {
        step: 'create_conversation',
        code: 'failed',
        message: msg,
      });
      onStepCompleted(failed);
      return err(msg);
    }

    return ok({ taskId });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const failed = await markRunFailed(run.id, {
      step: 'create_task',
      code: 'unknown',
      message: msg,
    });
    onStepCompleted(failed);
    return err(msg);
  }
}
