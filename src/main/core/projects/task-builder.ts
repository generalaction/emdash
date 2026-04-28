import type { Conversation } from '@shared/conversations';
import { taskProvisionProgressChannel } from '@shared/events/taskEvents';
import type { Task } from '@shared/tasks';
import type { Terminal } from '@shared/terminals';
import type { ConversationProvider } from '@main/core/conversations/types';
import type { GitFetchService } from '@main/core/git/git-fetch-service';
import type { GitRepositoryService } from '@main/core/git/repository-service';
import type { TerminalProvider } from '@main/core/terminals/terminal-provider';
import type { Workspace } from '@main/core/workspaces/workspace';
import { workspaceRegistry } from '@main/core/workspaces/workspace-registry';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import type { ProvisionResult, TaskProvider } from './project-provider';
import type { ProjectSettingsProvider } from './settings/schema';
import {
  buildTaskProviders,
  createWorkspaceFactory,
  resolveTaskEnv,
  type WorkspaceType,
} from './workspace-factory';
import { resolveTaskWorkDir } from './worktrees/utils';
import type { WorktreeService } from './worktrees/worktree-service';

export type BuildTaskResult = {
  taskProvider: TaskProvider;
  conversationProvider: ConversationProvider;
  terminalProvider: TerminalProvider;
};

export type ProvisionLocalTaskParams = {
  task: Task;
  conversations: Conversation[];
  terminals: Terminal[];
  workspaceId: string;
  type: WorkspaceType;
  projectId: string;
  projectPath: string;
  settings: ProjectSettingsProvider;
  worktreeService: WorktreeService;
  fetchService: GitFetchService;
  repository: GitRepositoryService;
  logPrefix: string;
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
    conversations,
    terminals,
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

  events.emit(taskProvisionProgressChannel, {
    taskId: task.id,
    projectId,
    step: 'resolving-worktree',
    message: 'Resolving worktree…',
  });
  const workDir = await resolveTaskWorkDir(task, projectPath, worktreeService);

  events.emit(taskProvisionProgressChannel, {
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
    events.emit(taskProvisionProgressChannel, {
      taskId: task.id,
      projectId,
      step: 'starting-sessions',
      message: 'Starting sessions…',
    });
    const buildTaskResult = await buildTaskFromWorkspace(
      task,
      workspace,
      type,
      projectId,
      projectPath,
      settings,
      { conversations, terminals },
      logPrefix
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
  hydrate: { conversations: Conversation[]; terminals: Terminal[] },
  logPrefix: string
): Promise<BuildTaskResult> {
  const { taskEnvVars, tmuxEnabled, shellSetup } = await resolveTaskEnv(
    task,
    workspace,
    projectPath,
    settings
  );

  const { conversations: conversationProvider, terminals: terminalProvider } = buildTaskProviders(
    type,
    {
      projectId,
      taskId: task.id,
      taskPath: workspace.path,
      tmuxEnabled,
      shellSetup,
      taskEnvVars,
    }
  );

  const taskProvider: TaskProvider = {
    taskId: task.id,
    taskBranch: task.taskBranch,
    sourceBranch: task.sourceBranch,
    taskEnvVars,
    conversations: conversationProvider,
    terminals: terminalProvider,
  };

  void Promise.all(
    hydrate.terminals.map((term) =>
      terminalProvider.spawnTerminal(term).catch((e) => {
        log.error(`${logPrefix}: failed to hydrate terminal`, {
          terminalId: term.id,
          error: String(e),
        });
      })
    )
  );

  void Promise.all(
    hydrate.conversations.map((conv) =>
      conversationProvider.startSession(conv, undefined, true).catch((e) => {
        log.error(`${logPrefix}: failed to hydrate conversation`, {
          conversationId: conv.id,
          error: String(e),
        });
      })
    )
  );

  return { taskProvider, conversationProvider, terminalProvider };
}
