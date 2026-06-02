import type { ConversationProvider } from '@main/core/conversations/types';
import type { GitFetchService } from '@main/core/git/git-fetch-service';
import type { GitRepositoryService } from '@main/core/git/repository-service';
import type { TerminalProvider } from '@main/core/terminals/terminal-provider';
import type { Workspace } from '@main/core/workspaces/workspace';
import { workspaceRegistry } from '@main/core/workspaces/workspace-registry';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import type { Conversation } from '@shared/conversations';
import { taskProvisionProgressChannel, type ProvisionStep } from '@shared/events/taskEvents';
import type { Task } from '@shared/tasks';
import type { ProvisionResult, TaskProvider } from '../projects/project-provider';
import type { ProjectSettingsProvider } from '../projects/settings/provider';
import { resolveTaskWorkDir } from '../projects/worktrees/utils';
import type { WorktreeService } from '../projects/worktrees/worktree-service';
import {
  buildTaskProviders,
  createWorkspaceFactory,
  resolveTaskEnv,
  type WorkspaceType,
} from '../workspaces/workspace-factory';
import { taskProvisionEvents } from './task-provision-events';

export function emitTaskProvisionProgress(data: {
  taskId: string;
  projectId: string;
  step: ProvisionStep;
  message: string;
}): void {
  events.emit(taskProvisionProgressChannel, data);
  taskProvisionEvents.emitProgress(data);
}

export type BuildTaskResult = {
  taskProvider: TaskProvider;
  conversationProvider: ConversationProvider;
  terminalProvider: TerminalProvider;
};

export type ProvisionLocalTaskParams = {
  task: Task;
  conversationsToHydrate?: Conversation[];
  workspaceId: string;
  type: WorkspaceType;
  projectId: string;
  projectPath: string;
  settings: ProjectSettingsProvider;
  worktreeService: WorktreeService;
  fetchService: GitFetchService;
  repository: GitRepositoryService;
  logPrefix: string;
  workDir?: string;
};

export type ProvisionLocalTaskResult = {
  provisionResult: ProvisionResult;
  workspace: Workspace;
  buildTaskResult: BuildTaskResult;
};

/**
 * Shared provision scaffolding for tasks whose workspace lives local to the
 * repository — either a worktree alongside the repo or the project root itself.
 * Works for both local and SSH transports (transport is encoded in `type`).
 *
 * Returns workspace and buildTaskResult so callers can perform their own
 * post-provision setup (e.g. git watcher registration, reconnect map population)
 * without lifecycle hook callbacks.
 */
export async function provisionLocalTask(
  params: ProvisionLocalTaskParams
): Promise<ProvisionLocalTaskResult> {
  const {
    task,
    conversationsToHydrate = [],
    workspaceId,
    type,
    projectId,
    projectPath,
    settings,
    worktreeService,
    fetchService,
    repository,
    logPrefix,
  } = params;

  emitTaskProvisionProgress({
    taskId: task.id,
    projectId,
    step: 'resolving-worktree',
    message: 'Resolving worktree…',
  });
  const workDir = params.workDir ?? (await resolveTaskWorkDir(task, projectPath, worktreeService));

  emitTaskProvisionProgress({
    taskId: task.id,
    projectId,
    step: 'initialising-workspace',
    message: 'Initialising workspace…',
  });
  const workspace = await workspaceRegistry.acquire(
    workspaceId,
    projectId,
    createWorkspaceFactory(workspaceId, type, {
      task,
      workDir,
      projectId,
      projectPath,
      settings,
      logPrefix,
      repository,
      fetchService,
    })
  );

  let provisionSucceeded = false;
  try {
    emitTaskProvisionProgress({
      taskId: task.id,
      projectId,
      step: 'starting-sessions',
      message: 'Preparing task…',
    });
    const buildTaskResult = await buildTaskFromWorkspace(
      task,
      workspace,
      type,
      projectId,
      projectPath,
      settings,
      conversationsToHydrate
    );
    log.debug(`${logPrefix}: provisionLocalTask DONE`, { taskId: task.id });
    provisionSucceeded = true;
    return {
      provisionResult: { taskProvider: buildTaskResult.taskProvider, persistData: { workspaceId } },
      workspace,
      buildTaskResult,
    };
  } finally {
    if (!provisionSucceeded) {
      await workspaceRegistry.release(workspace.id, 'terminate').catch(() => {});
    }
  }
}

/**
 * Shared tail of doProvisionTask — builds and hydrates a TaskProvider from
 * an already-acquired workspace. Works for both local and SSH transports.
 *
 * Returns all three provider objects so callers (e.g. SshProjectProvider)
 * can keep references for reconnect rehydration.
 */
export async function buildTaskFromWorkspace(
  task: Task,
  workspace: Workspace,
  type: WorkspaceType,
  projectId: string,
  projectPath: string,
  settings: ProjectSettingsProvider,
  conversationsToHydrate: Conversation[] = []
): Promise<BuildTaskResult> {
  const { taskEnvVars, tmuxEnabled, shellSetup } = await resolveTaskEnv(
    task,
    workspace,
    projectPath,
    settings
  );

  const { conversations: conversationProvider, terminals: terminalProvider } =
    await buildTaskProviders(type, {
      projectId,
      taskId: task.id,
      taskPath: workspace.path,
      tmuxEnabled,
      shellSetup,
      taskEnvVars,
    });

  const taskProvider: TaskProvider = {
    taskId: task.id,
    taskBranch: task.taskBranch,
    sourceBranch: task.sourceBranch,
    taskEnvVars,
    conversations: conversationProvider,
    terminals: terminalProvider,
  };

  await Promise.all(
    conversationsToHydrate.map((conv) =>
      conversationProvider.startSession(conv, undefined, true).catch((e) => {
        log.error('buildTaskFromWorkspace: failed to hydrate conversation from view state', {
          conversationId: conv.id,
          error: String(e),
        });
      })
    )
  );

  return { taskProvider, conversationProvider, terminalProvider };
}
