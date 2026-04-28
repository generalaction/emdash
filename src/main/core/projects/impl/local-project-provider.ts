import fs from 'node:fs';
import path from 'node:path';
import type { Conversation } from '@shared/conversations';
import { gitRefChangedChannel } from '@shared/events/gitEvents';
import { taskProvisionProgressChannel } from '@shared/events/taskEvents';
import type { FetchError } from '@shared/git';
import { bareRefName } from '@shared/git-utils';
import type { LocalProject, ProjectRemoteState } from '@shared/projects';
import { makePtySessionId } from '@shared/ptySessionId';
import { err, ok, type Result } from '@shared/result';
import { type Task, type TaskBootstrapStatus } from '@shared/tasks';
import { type Terminal } from '@shared/terminals';
import { workspaceKey } from '@shared/workspace-key';
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
import type { Workspace } from '@main/core/workspaces/workspace';
import { WorkspaceRegistry } from '@main/core/workspaces/workspace-registry';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { quoteShellArg } from '@main/utils/shellEscape';
import {
  type ProjectProvider,
  type ProvisionTaskError,
  type TaskProvider,
  type TeardownTaskError,
} from '../project-provider';
import { parseProvisionOutput } from '../provision-output';
import {
  formatProvisionTaskError,
  TASK_TIMEOUT_MS,
  toProvisionError,
  toTeardownError,
} from '../provision-task-error';
import { LocalProjectSettingsProvider } from '../settings/project-settings';
import type { ProjectSettings, ProjectSettingsProvider } from '../settings/schema';
import { buildTaskFromWorkspace } from '../task-builder';
import { withTimeout } from '../utils';
import { createWorkspaceFactory } from '../workspace-factory';
import { resolveTaskWorkDir } from '../worktrees/utils';
import { WorktreeService } from '../worktrees/worktree-service';

export async function createLocalProvider(
  project: LocalProject,
  rootFs: FileSystemProvider
): Promise<LocalProjectProvider> {
  const settings = new LocalProjectSettingsProvider(
    project.path,
    bareRefName(project.baseRef),
    rootFs
  );
  const worktreePoolPath = path.join(await settings.getWorktreeDirectory(), project.name);

  await fs.promises.mkdir(worktreePoolPath, { recursive: true });

  return new LocalProjectProvider(project, rootFs, { settings, worktreePoolPath });
}

export class LocalProjectProvider implements ProjectProvider {
  readonly type = 'local';
  readonly settings: ProjectSettingsProvider;
  readonly repository: GitRepositoryService;
  readonly fs: FileSystemProvider;

  private tasks = new Map<string, TaskProvider>();
  private provisioningTasks = new Map<string, Promise<Result<TaskProvider, ProvisionTaskError>>>();
  private tearingDownTasks = new Map<string, Promise<Result<void, TeardownTaskError>>>();
  private bootstrapErrors = new Map<string, ProvisionTaskError>();
  private worktreeService: WorktreeService;
  private workspaceRegistry = new WorkspaceRegistry();
  private readonly localExec = getLocalExec();
  private readonly _gitWatcher: GitWatcherService;
  private readonly _gitFetchService: GitFetchService;
  private _configChangeUnsubscribe: (() => void) | undefined;
  private _remoteHandles = new Map<
    string,
    {
      terminationId: string | undefined;
      terminateCommand: string;
    }
  >();

  constructor(
    private readonly project: LocalProject,
    readonly rootFs: FileSystemProvider,
    options: {
      settings: ProjectSettingsProvider;
      worktreePoolPath: string;
    }
  ) {
    this.settings = options.settings;
    this.fs = new LocalFileSystem(project.path);
    const gitExec = getGitLocalExec(() => githubConnectionService.getToken());
    const repoGit = new GitService(project.path, gitExec, this.fs);
    this.repository = new GitRepositoryService(repoGit, this.settings);
    this.worktreeService = new WorktreeService({
      worktreePoolPath: options.worktreePoolPath,
      repoPath: project.path,
      projectSettings: this.settings,
      exec: gitExec,
      rootFs: rootFs,
    });
    this._gitWatcher = new GitWatcherService(project.id, project.path);
    void this._gitWatcher.start();

    this._gitFetchService = new GitFetchService(
      repoGit,
      async () => (await githubConnectionService.getToken()) !== null
    );
    this._gitFetchService.start();

    // Re-sync remotes whenever .git/config changes (remote added/removed/changed)
    this._configChangeUnsubscribe = events.on(gitRefChangedChannel, (p) => {
      if (p.projectId === project.id && p.kind === 'config') {
        void prSyncScheduler.onRemoteChanged(project.id);
      }
    });
  }

  async provisionTask(
    task: Task,
    conversations: Conversation[],
    terminals: Terminal[]
  ): Promise<Result<TaskProvider, ProvisionTaskError>> {
    const existing = this.tasks.get(task.id);
    if (existing) return ok(existing);
    if (this.provisioningTasks.has(task.id)) return this.provisioningTasks.get(task.id)!;

    const promise = withTimeout(
      this.doProvisionTask(task, conversations, terminals),
      TASK_TIMEOUT_MS
    )
      .then((taskEnv) => {
        this.tasks.set(task.id, taskEnv);
        this.provisioningTasks.delete(task.id);
        return ok(taskEnv);
      })
      .catch((e) => {
        const provisionError = toProvisionError(e);
        this.bootstrapErrors.set(task.id, provisionError);
        this.provisioningTasks.delete(task.id);
        log.error('LocalProjectProvider: failed to provision task', {
          taskId: task.id,
          error: String(e),
        });
        return err(provisionError);
      });

    this.provisioningTasks.set(task.id, promise);
    return promise;
  }

  private async doProvisionTask(
    task: Task,
    conversations: Conversation[],
    terminals: Terminal[]
  ): Promise<TaskProvider> {
    log.debug('LocalProjectProvider: doProvisionTask START', { taskId: task.id });

    const settings = await this.settings.get();
    if (task.workspaceProvider === 'ssh' && settings.workspaceProvider?.type === 'script') {
      return this.doProvisionRemoteTask(task, conversations, terminals, settings.workspaceProvider);
    }

    // Refresh remote-tracking refs in the background so they are as fresh as
    // possible during the lifetime of this task. Non-blocking — provision
    // continues without waiting for the network round-trip.
    void this._gitFetchService.fetch();

    // Sync PRs for this task's branch in the background.
    void prSyncScheduler.onTaskProvisioned(this.project.id, task.taskBranch);

    const workspaceId = workspaceKey(task.taskBranch);

    events.emit(taskProvisionProgressChannel, {
      taskId: task.id,
      projectId: this.project.id,
      step: 'resolving-worktree',
      message: 'Resolving worktree…',
    });
    const workDir = await resolveTaskWorkDir(task, this.project.path, this.worktreeService);

    events.emit(taskProvisionProgressChannel, {
      taskId: task.id,
      projectId: this.project.id,
      step: 'initialising-workspace',
      message: 'Initialising workspace…',
    });
    const workspace = await this.workspaceRegistry.acquire(
      workspaceId,
      createWorkspaceFactory(
        workspaceId,
        { kind: 'local' },
        {
          task,
          workDir,
          projectId: this.project.id,
          projectPath: this.project.path,
          settings: this.settings,
          logPrefix: 'LocalProjectProvider',
          repository: this.repository,
          fetchService: this._gitFetchService,
          extraHooks: {
            onCreate: async (ws) => {
              const mainDotGitAbs = path.resolve(this.project.path, '.git');
              const relativeGitDir = await ws.git.getWorktreeGitDir(mainDotGitAbs);
              this._gitWatcher.registerWorktree(workspaceId, relativeGitDir);
            },
            onDestroy: async () => this._gitWatcher.unregisterWorktree(workspaceId),
          },
        }
      )
    );

    let provisionSucceeded = false;
    try {
      events.emit(taskProvisionProgressChannel, {
        taskId: task.id,
        projectId: this.project.id,
        step: 'starting-sessions',
        message: 'Starting sessions…',
      });
      const { taskProvider } = await buildTaskFromWorkspace(
        task,
        workspace,
        { kind: 'local' },
        this.project.id,
        this.project.path,
        this.settings,
        { conversations, terminals },
        'LocalProjectProvider'
      );
      log.debug('LocalProjectProvider: doProvisionTask DONE', { taskId: task.id });
      provisionSucceeded = true;
      return taskProvider;
    } finally {
      if (!provisionSucceeded) {
        await this.workspaceRegistry.release(workspace.id).catch(() => {});
      }
    }
  }

  private async doProvisionRemoteTask(
    task: Task,
    conversations: Conversation[],
    terminals: Terminal[],
    wpConfig: NonNullable<ProjectSettings['workspaceProvider']>
  ): Promise<TaskProvider> {
    events.emit(taskProvisionProgressChannel, {
      taskId: task.id,
      projectId: this.project.id,
      step: 'running-provision-script',
      message: 'Running provision script…',
    });

    const { stdout } = await this.localExec('/bin/sh', ['-c', wpConfig.provisionCommand], {
      cwd: this.project.path,
    });

    const parseResult = parseProvisionOutput(stdout);
    if (!parseResult.success) {
      throw new Error(parseResult.error.message);
    }
    const output = parseResult.data;

    events.emit(taskProvisionProgressChannel, {
      taskId: task.id,
      projectId: this.project.id,
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

    this._remoteHandles.set(task.id, {
      terminationId: output.id,
      terminateCommand: wpConfig.terminateCommand,
    });

    events.emit(taskProvisionProgressChannel, {
      taskId: task.id,
      projectId: this.project.id,
      step: 'setting-up-workspace',
      message: 'Setting up workspace…',
    });

    const workDir = output.worktreePath ?? this.project.path;
    const workspaceId = workspaceKey(task.taskBranch);

    const workspace = await this.workspaceRegistry.acquire(
      workspaceId,
      createWorkspaceFactory(
        workspaceId,
        { kind: 'ssh', proxy },
        {
          task,
          workDir,
          projectId: this.project.id,
          projectPath: this.project.path,
          settings: this.settings,
          logPrefix: 'LocalProjectProvider[remote]',
          extraHooks: {
            onDestroy: async () => {
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
        projectId: this.project.id,
        step: 'starting-sessions',
        message: 'Starting sessions…',
      });
      const { taskProvider } = await buildTaskFromWorkspace(
        task,
        workspace,
        { kind: 'ssh', proxy },
        this.project.id,
        this.project.path,
        this.settings,
        { conversations, terminals },
        'LocalProjectProvider[remote]'
      );
      log.debug('LocalProjectProvider: doProvisionRemoteTask DONE', { taskId: task.id });
      provisionSucceeded = true;
      return taskProvider;
    } finally {
      if (!provisionSucceeded) {
        await this.workspaceRegistry.release(workspace.id).catch(() => {});
      }
    }
  }

  getTask(taskId: string): TaskProvider | undefined {
    return this.tasks.get(taskId);
  }

  getTaskBootstrapStatus(taskId: string): TaskBootstrapStatus {
    if (this.tasks.has(taskId)) return { status: 'ready' };
    if (this.provisioningTasks.has(taskId)) return { status: 'bootstrapping' };
    const bootstrapError = this.bootstrapErrors.get(taskId);
    if (bootstrapError)
      return { status: 'error', message: formatProvisionTaskError(bootstrapError) };
    return { status: 'not-started' };
  }

  async teardownTask(taskId: string): Promise<Result<void, TeardownTaskError>> {
    if (this.tearingDownTasks.has(taskId)) return this.tearingDownTasks.get(taskId)!;
    const task = this.tasks.get(taskId);
    if (!task) {
      await this.cleanupDetachedTmuxSessions(taskId);
      return ok();
    }

    const promise = withTimeout(this.doTeardownTask(task), TASK_TIMEOUT_MS)
      .then(() => ok<void>())
      .catch(async (e) => {
        log.error('LocalProjectProvider: failed to teardown task', {
          taskId,
          error: String(e),
        });
        await this.cleanupDetachedTmuxSessions(taskId).catch((cleanupError) => {
          log.warn('LocalProjectProvider: fallback tmux cleanup failed', {
            taskId,
            error: String(cleanupError),
          });
        });
        return err<TeardownTaskError>(toTeardownError(e));
      })
      .finally(() => {
        this.tasks.delete(taskId);
        this.tearingDownTasks.delete(taskId);
      });

    this.tearingDownTasks.set(taskId, promise);
    return promise;
  }

  getWorkspace(workspaceId: string): Workspace | undefined {
    return this.workspaceRegistry.get(workspaceId);
  }

  private async doTeardownTask(task: TaskProvider): Promise<void> {
    await task.conversations.destroyAll();
    await task.terminals.destroyAll();
    await this.workspaceRegistry.release(workspaceKey(task.taskBranch));

    const handle = this._remoteHandles.get(task.taskId);
    if (handle) {
      const cmd = handle.terminationId
        ? `REMOTE_WORKSPACE_ID=${quoteShellArg(handle.terminationId)} ${handle.terminateCommand}`
        : handle.terminateCommand;
      await this.localExec('/bin/sh', ['-c', cmd], { cwd: this.project.path }).catch((e) => {
        log.warn('LocalProjectProvider: terminate command failed', { error: String(e) });
      });
      this._remoteHandles.delete(task.taskId);
    }
  }

  private async cleanupDetachedTmuxSessions(taskId: string): Promise<void> {
    const { conversationIds, terminalIds } = await getTaskSessionLeafIds(this.project.id, taskId);
    const sessionIds = [...conversationIds, ...terminalIds].map((leafId) =>
      makePtySessionId(this.project.id, taskId, leafId)
    );
    await Promise.all(
      sessionIds.map((sessionId) => killTmuxSession(this.localExec, makeTmuxSessionName(sessionId)))
    );
  }

  async getWorktreeForBranch(branchName: string): Promise<string | undefined> {
    return this.worktreeService.getWorktree(branchName);
  }

  async removeTaskWorktree(taskBranch: string): Promise<void> {
    const worktreePath = await this.worktreeService.getWorktree(taskBranch);
    if (worktreePath) {
      await this.worktreeService.removeWorktree(worktreePath);
    }
  }

  async fetch(): Promise<Result<void, FetchError>> {
    return this._gitFetchService.fetch();
  }

  async cleanup(): Promise<void> {
    this._configChangeUnsubscribe?.();
    this._gitFetchService.stop();
    await this._gitWatcher.stop();

    const settings = await this.settings.get();

    if (settings.tmux) {
      await Promise.all(
        Array.from(this.tasks.values()).map((task) =>
          Promise.all([task.conversations.detachAll(), task.terminals.detachAll()])
        )
      );
      this.tasks.clear();
      await this.workspaceRegistry.releaseAll();
    } else {
      await Promise.all(Array.from(this.tasks.keys()).map((id) => this.teardownTask(id)));
      await this.workspaceRegistry.releaseAll();
    }
  }

  getRemoteState(): Promise<ProjectRemoteState> {
    return this.repository.getRemoteState();
  }
}
