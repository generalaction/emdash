import fs from 'node:fs';
import path from 'node:path';
import type { Conversation } from '@shared/conversations';
import { gitRefChangedChannel } from '@shared/events/gitEvents';
import { taskProvisionProgressChannel } from '@shared/events/taskEvents';
import { bareRefName } from '@shared/git-utils';
import type { LocalProject } from '@shared/projects';
import { makePtySessionId } from '@shared/ptySessionId';
import type { Task } from '@shared/tasks';
import type { Terminal } from '@shared/terminals';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import type { FileSystemProvider } from '@main/core/fs/types';
import { GitFetchService } from '@main/core/git/git-fetch-service';
import { GitWatcherService } from '@main/core/git/git-watcher-service';
import { GitService } from '@main/core/git/impl/git-service';
import { GitRepositoryService } from '@main/core/git/repository-service';
import { githubConnectionService } from '@main/core/github/services/github-connection-service';
import { killTmuxSession, makeTmuxSessionName } from '@main/core/pty/tmux-session-name';
import { prSyncScheduler } from '@main/core/pull-requests/pr-sync-scheduler';
import { sshConnectionManager } from '@main/core/ssh/ssh-connection-manager';
import { getTaskSessionLeafIds } from '@main/core/tasks/session-targets';
import { getGitLocalExec, getLocalExec } from '@main/core/utils/exec';
import { localWorkspaceId, remoteTaskWorkspaceId } from '@main/core/workspaces/workspace-id';
import { workspaceRegistry } from '@main/core/workspaces/workspace-registry';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { quoteShellArg } from '@main/utils/shellEscape';
import { type ProjectProvider, type TaskProvider, type TeardownMode } from '../project-provider';
import { parseProvisionOutput } from '../provision-output';
import { LocalProjectSettingsProvider } from '../settings/project-settings';
import type { ProjectSettings } from '../settings/schema';
import { buildTaskFromWorkspace } from '../task-builder';
import { TaskProvisionManager } from '../task-provision-manager';
import { createWorkspaceFactory } from '../workspace-factory';
import { resolveTaskWorkDir } from '../worktrees/utils';
import { WorktreeService } from '../worktrees/worktree-service';

export async function createLocalProvider(
  project: LocalProject,
  rootFs: FileSystemProvider
): Promise<ProjectProvider> {
  const settings = new LocalProjectSettingsProvider(
    project.path,
    bareRefName(project.baseRef),
    rootFs
  );
  const worktreePoolPath = path.join(await settings.getWorktreeDirectory(), project.name);
  await fs.promises.mkdir(worktreePoolPath, { recursive: true });

  const localFs = new LocalFileSystem(project.path);
  const gitExec = getGitLocalExec(() => githubConnectionService.getToken());
  const repoGit = new GitService(project.path, gitExec, localFs);
  const repository = new GitRepositoryService(repoGit, settings);
  const worktreeService = new WorktreeService({
    worktreePoolPath,
    repoPath: project.path,
    projectSettings: settings,
    exec: gitExec,
    rootFs,
  });
  const gitWatcher = new GitWatcherService(project.id, project.path);
  void gitWatcher.start();

  const gitFetchService = new GitFetchService(
    repoGit,
    async () => (await githubConnectionService.getToken()) !== null
  );
  gitFetchService.start();

  const configChangeUnsub = events.on(gitRefChangedChannel, (p) => {
    if (p.projectId === project.id && p.kind === 'config') {
      void prSyncScheduler.onRemoteChanged(project.id);
    }
  });

  const localExec = getLocalExec();

  async function doProvisionTask(
    task: Task,
    conversations: Conversation[],
    terminals: Terminal[]
  ): Promise<TaskProvider> {
    log.debug('LocalProjectProvider: doProvisionTask START', { taskId: task.id });

    const projectSettings = await settings.get();
    const useSsh =
      task.workspaceProvider != null
        ? task.workspaceProvider === 'ssh'
        : projectSettings.workspaceProvider?.type === 'script';
    if (useSsh && projectSettings.workspaceProvider?.type === 'script') {
      return doProvisionRemoteTask(
        task,
        conversations,
        terminals,
        projectSettings.workspaceProvider
      );
    }

    void gitFetchService.fetch();
    void prSyncScheduler.onTaskProvisioned(project.id, task.taskBranch);

    const workspaceId = localWorkspaceId(project.id, task.taskBranch);

    events.emit(taskProvisionProgressChannel, {
      taskId: task.id,
      projectId: project.id,
      step: 'resolving-worktree',
      message: 'Resolving worktree…',
    });
    const workDir = await resolveTaskWorkDir(task, project.path, worktreeService);

    events.emit(taskProvisionProgressChannel, {
      taskId: task.id,
      projectId: project.id,
      step: 'initialising-workspace',
      message: 'Initialising workspace…',
    });
    const workspace = await workspaceRegistry.acquire(
      workspaceId,
      project.id,
      createWorkspaceFactory(
        workspaceId,
        { kind: 'local' },
        {
          task,
          workDir,
          projectId: project.id,
          projectPath: project.path,
          settings,
          logPrefix: 'LocalProjectProvider',
          repository,
          fetchService: gitFetchService,
          extraHooks: {
            onCreate: async (ws) => {
              const mainDotGitAbs = path.resolve(project.path, '.git');
              const relativeGitDir = await ws.git.getWorktreeGitDir(mainDotGitAbs);
              gitWatcher.registerWorktree(workspaceId, relativeGitDir);
            },
            onDestroy: async () => gitWatcher.unregisterWorktree(workspaceId),
          },
        }
      )
    );

    let provisionSucceeded = false;
    try {
      events.emit(taskProvisionProgressChannel, {
        taskId: task.id,
        projectId: project.id,
        step: 'starting-sessions',
        message: 'Starting sessions…',
      });
      const { taskProvider } = await buildTaskFromWorkspace(
        task,
        workspace,
        { kind: 'local' },
        project.id,
        project.path,
        settings,
        { conversations, terminals },
        'LocalProjectProvider'
      );
      log.debug('LocalProjectProvider: doProvisionTask DONE', { taskId: task.id });
      provisionSucceeded = true;
      return taskProvider;
    } finally {
      if (!provisionSucceeded) {
        await workspaceRegistry.release(workspace.id, 'terminate').catch(() => {});
      }
    }
  }

  async function doProvisionRemoteTask(
    task: Task,
    conversations: Conversation[],
    terminals: Terminal[],
    wpConfig: NonNullable<ProjectSettings['workspaceProvider']>
  ): Promise<TaskProvider> {
    events.emit(taskProvisionProgressChannel, {
      taskId: task.id,
      projectId: project.id,
      step: 'running-provision-script',
      message: 'Running provision script…',
    });

    const { stdout } = await localExec('/bin/sh', ['-c', wpConfig.provisionCommand], {
      cwd: project.path,
    });

    const parseResult = parseProvisionOutput(stdout);
    if (!parseResult.success) {
      throw new Error(parseResult.error.message);
    }
    const output = parseResult.data;

    events.emit(taskProvisionProgressChannel, {
      taskId: task.id,
      projectId: project.id,
      step: 'connecting',
      message: `Connecting to ${output.host}…`,
    });

    const connectionId = `task:${task.id}`;
    const proxy = await sshConnectionManager.connectFromConfig(connectionId, {
      host: output.host,
      port: output.port ?? 22,
      username: output.username ?? process.env['USER'],
      agent: process.env['SSH_AUTH_SOCK'],
    });

    events.emit(taskProvisionProgressChannel, {
      taskId: task.id,
      projectId: project.id,
      step: 'setting-up-workspace',
      message: 'Setting up workspace…',
    });

    const workDir = output.worktreePath ?? project.path;
    const workspaceId = remoteTaskWorkspaceId(output.id ?? task.id);

    const workspace = await workspaceRegistry.acquire(
      workspaceId,
      project.id,
      createWorkspaceFactory(
        workspaceId,
        { kind: 'ssh', proxy },
        {
          task,
          workDir,
          projectId: project.id,
          projectPath: project.path,
          settings,
          logPrefix: 'LocalProjectProvider[remote]',
          extraHooks: {
            onDestroy: async () => {
              const cmd = output.id
                ? `REMOTE_WORKSPACE_ID=${quoteShellArg(output.id)} ${wpConfig.terminateCommand}`
                : wpConfig.terminateCommand;
              await localExec('/bin/sh', ['-c', cmd], { cwd: project.path }).catch((e) => {
                log.warn('LocalProjectProvider: terminate command failed', { error: String(e) });
              });
              await sshConnectionManager.disconnect(connectionId);
            },
            onDetach: async () => {
              await sshConnectionManager.disconnect(connectionId);
            },
          },
        }
      )
    );

    let provisionSucceeded = false;
    try {
      events.emit(taskProvisionProgressChannel, {
        taskId: task.id,
        projectId: project.id,
        step: 'starting-sessions',
        message: 'Starting sessions…',
      });
      const { taskProvider: baseTaskProvider } = await buildTaskFromWorkspace(
        task,
        workspace,
        { kind: 'ssh', proxy },
        project.id,
        project.path,
        settings,
        { conversations, terminals },
        'LocalProjectProvider[remote]'
      );
      const taskProvider: TaskProvider = {
        ...baseTaskProvider,
        workspaceProviderData: JSON.stringify({ ...wpConfig, remoteWorkspaceId: output.id }),
      };
      log.debug('LocalProjectProvider: doProvisionRemoteTask DONE', { taskId: task.id });
      provisionSucceeded = true;
      return taskProvider;
    } finally {
      if (!provisionSucceeded) {
        await workspaceRegistry.release(workspace.id, 'terminate').catch(() => {});
      }
    }
  }

  async function doTeardownTask(task: TaskProvider, mode: TeardownMode): Promise<void> {
    if (mode === 'detach') {
      await task.conversations.detachAll();
      await task.terminals.detachAll();
    } else {
      await task.conversations.destroyAll();
      await task.terminals.destroyAll();
    }
    await workspaceRegistry.release(task.workspaceId, mode);
  }

  async function cleanupDetachedTmuxSessions(taskId: string): Promise<void> {
    const { conversationIds, terminalIds } = await getTaskSessionLeafIds(project.id, taskId);
    const sessionIds = [...conversationIds, ...terminalIds].map((leafId) =>
      makePtySessionId(project.id, taskId, leafId)
    );
    await Promise.all(
      sessionIds.map((sessionId) => killTmuxSession(localExec, makeTmuxSessionName(sessionId)))
    );
  }

  const taskManager = new TaskProvisionManager(
    'LocalProjectProvider',
    doProvisionTask,
    doTeardownTask,
    cleanupDetachedTmuxSessions
  );

  return {
    type: 'local',
    settings,
    repository,
    fs: localFs,
    tasks: taskManager,
    getWorktreeForBranch: (branch) => worktreeService.getWorktree(branch),
    removeTaskWorktree: async (taskBranch) => {
      const worktreePath = await worktreeService.getWorktree(taskBranch);
      if (worktreePath) {
        await worktreeService.removeWorktree(worktreePath);
      }
    },
    fetch: () => gitFetchService.fetch(),
    getRemoteState: () => repository.getRemoteState(),
    cleanup: async () => {
      configChangeUnsub();
      gitFetchService.stop();
      await gitWatcher.stop();
      const projectSettings = await settings.get();
      const mode = projectSettings.tmux ? 'detach' : 'terminate';
      await taskManager.teardownAll({ mode });
      await workspaceRegistry.releaseAllForProject(project.id, mode);
    },
  };
}
