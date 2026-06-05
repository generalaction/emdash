import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createConversation } from '@main/core/conversations/createConversation';
import { ensureRepositoryWorkspace } from '@main/core/projects/operations/ensure-repository-workspace';
import { openProject } from '@main/core/projects/operations/openProject';
import { projectManager } from '@main/core/projects/project-manager';
import { DEFAULT_AGENT_ID } from '@main/core/settings/settings-registry';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import { appSettingsService } from '@main/core/settings/settings-service';
import { generateRandom, generateTaskName } from '@main/core/tasks/name-generation/generateTaskName';
import {
  commitCreateTask,
  finalizeCreateTask,
  prepareCreateTask,
} from '@main/core/tasks/operations/createTask';
import { taskService } from '@main/core/tasks/task-service';
import { db } from '@main/db/client';
import type { ConversationRow, TaskRow } from '@main/db/schema';
import { automationRuns, projects } from '@main/db/schema';
import { resolveAutomationAgentAutoApprove } from '@shared/agent-auto-approve-defaults';
import type { Branch } from '@shared/git';
import { bareRefName } from '@shared/git-utils';
import type { Automation } from '@shared/automations/automation';
import type { AutomationRun } from '@shared/automations/automation-run';
import type { LocalProject, SshProject } from '@shared/projects';
import { err, ok, type Result } from '@shared/result';
import type { CreateTaskParams, GitSetup } from '@shared/tasks';
import { type WorkspaceConfig, type WorkspaceTarget } from '@shared/workspace-config';
import {
  markRunCreatingConversation,
  markRunFailed,
  markRunLaunchingTask,
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

  let workspace: WorkspaceTarget;
  if (git.kind === 'none') {
    const workspaceId = await ensureRepositoryWorkspace(await getProjectData(project.projectId));
    workspace = { kind: 'repository-instance', workspaceId };
  } else {
    workspace = { kind: 'new-worktree' };
  }

  return { version: '2', git, workspace };
}

async function getProjectData(projectId: string): Promise<LocalProject | SshProject> {
  const [row] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!row) throw new Error(`Project ${projectId} not found`);
  if (row.workspaceProvider === 'ssh') {
    return {
      type: 'ssh',
      id: row.id,
      name: row.name,
      path: row.path,
      baseRef: row.baseRef ?? 'main',
      connectionId: row.sshConnectionId!,
      repositoryWorkspaceId: row.repositoryWorkspaceId ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
  return {
    type: 'local',
    id: row.id,
    name: row.name,
    path: row.path,
    baseRef: row.baseRef ?? 'main',
    repositoryWorkspaceId: row.repositoryWorkspaceId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
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

export async function executeTaskCreate(
  automation: Automation,
  run: AutomationRun
): Promise<Result<{ taskId: string }, string>> {
  const prompt = automation.conversationConfig?.prompt.trim();
  if (!prompt) return err('task_create_prompt_empty');

  const projectId = automation.projectId;
  if (!projectId) return err('no_project_attached');

  try {
    const taskConfig = automation.taskConfig;
    const taskId = randomUUID();
    const conversationId = randomUUID();
    const taskName = generateRandom();

    const projectResult = await ensureProjectOpen(projectId);
    if (!projectResult.success) {
      await markRunFailed(run.id, { step: 'create_task', code: 'project_not_found' });
      return err(projectResult.error);
    }
    const project = projectResult.data;

    let workspaceConfig: WorkspaceConfig;
    if (taskConfig?.workspaceConfig) {
      workspaceConfig = scopeWorkspaceConfigToRun(taskConfig.workspaceConfig, run.id);
    } else {
      workspaceConfig = await resolveProjectDefaults(project, taskName);
    }

    const provider =
      (automation.conversationConfig?.provider ||
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
      await markRunFailed(run.id, runError);
      return err(error.type);
    }

    let taskRow!: TaskRow;
    let convRow: ConversationRow | undefined;
    db.transaction((tx) => {
      ({ taskRow, convRow } = commitCreateTask(prepared.data, tx));
      tx.update(automationRuns).set({ taskId }).where(eq(automationRuns.id, run.id)).run();
    });

    const createSuccess = finalizeCreateTask(prepared.data, taskRow, convRow);
    taskService.notifyTaskCreated(createSuccess.task, createTaskParams);

    await markRunLaunchingTask(run.id, taskId, Date.now());

    try {
      const provision = await taskService.launch(taskId);
      if (!provision.success) {
        const msg = provision.error.type === 'setup-failed' ? provision.error.message : undefined;
        await markRunFailed(run.id, {
          step: 'launch_task',
          code: 'provision_failed',
          message: msg,
        });
        return err('provision_failed');
      }

      await markRunCreatingConversation(run.id, Date.now());

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
      await markRunFailed(run.id, {
        step: 'create_conversation',
        code: 'failed',
        message: msg,
      });
      return err(msg);
    }

    return ok({ taskId });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await markRunFailed(run.id, { step: 'create_task', code: 'unknown', message: msg });
    return err(msg);
  }
}
