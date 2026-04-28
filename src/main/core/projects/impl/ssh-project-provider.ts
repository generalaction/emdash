import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { SFTPWrapper } from 'ssh2';
import { type Conversation } from '@shared/conversations';
import type { FetchError } from '@shared/git';
import { bareRefName } from '@shared/git-utils';
import type { SshProject } from '@shared/projects';
import { makePtySessionId } from '@shared/ptySessionId';
import { err, ok, type Result } from '@shared/result';
import { getTaskEnvVars } from '@shared/task/envVars';
import { type Task, type TaskBootstrapStatus } from '@shared/tasks';
import { type Terminal } from '@shared/terminals';
import { workspaceKey } from '@shared/workspace-key';
import { SshConversationProvider } from '@main/core/conversations/impl/ssh-conversation';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import type { FileSystemProvider } from '@main/core/fs/types';
import { GitFetchService } from '@main/core/git/git-fetch-service';
import { GitService } from '@main/core/git/impl/git-service';
import { GitRepositoryService } from '@main/core/git/repository-service';
import { githubConnectionService } from '@main/core/github/services/github-connection-service';
import { killTmuxSession, makeTmuxSessionName } from '@main/core/pty/tmux-session-name';
import { prSyncScheduler } from '@main/core/pull-requests/pr-sync-scheduler';
import { type SshClientProxy } from '@main/core/ssh/ssh-client-proxy';
import { type SshConnectionEvent, sshConnectionManager } from '@main/core/ssh/ssh-connection-manager';
import { getTaskSessionLeafIds } from '@main/core/tasks/session-targets';
import { SshTerminalProvider } from '@main/core/terminals/impl/ssh-terminal-provider';
import { getGitSshExec, getSshExec } from '@main/core/utils/exec';
import type { Workspace } from '@main/core/workspaces/workspace';
import { WorkspaceLifecycleService } from '@main/core/workspaces/workspace-lifecycle-service';
import { WorkspaceRegistry } from '@main/core/workspaces/workspace-registry';
import { log } from '@main/lib/logger';
import {
  type ProjectProvider,
  type ProjectRemoteState,
  type ProvisionTaskError,
  type TaskProvider,
  type TeardownTaskError,
} from '../project-provider';
import {
  formatProvisionTaskError,
  isProvisionTaskError,
  mapWorktreeErrorToProvisionError,
} from '../provision-task-error';
import { SshProjectSettingsProvider } from '../settings/project-settings';
import type { ProjectSettingsProvider } from '../settings/schema';
import { getEffectiveTaskSettings } from '../settings/task-settings';
import { TimeoutSignal, withTimeout } from '../utils';
import { SshWorktreeHost } from '../worktrees/hosts/ssh-worktree-host';
import type { WorktreeHost } from '../worktrees/hosts/worktree-host';
import { WorktreeService } from '../worktrees/worktree-service';

const TASK_TIMEOUT_MS = 60_000;
const TEARDOWN_SCRIPT_WAIT_MS = 10_000;

function toProvisionError(e: unknown): ProvisionTaskError {
  if (isProvisionTaskError(e)) return e;
  if (e instanceof TimeoutSignal) return { type: 'timeout', message: e.message, timeout: e.ms };
  return { type: 'error', message: e instanceof Error ? e.message : String(e) };
}

function toTeardownError(e: unknown): TeardownTaskError {
  if (e instanceof TimeoutSignal) return { type: 'timeout', message: e.message, timeout: e.ms };
  return { type: 'error', message: e instanceof Error ? e.message : String(e) };
}

export async function createSshProvider(
  project: SshProject,
  rootFs: FileSystemProvider,
  proxy: SshClientProxy
): Promise<SshProjectProvider> {
  try {
    const projectFs = new SshFileSystem(proxy, project.path);
    const exec = getSshExec(proxy);

    const settings = new SshProjectSettingsProvider(
      projectFs,
      bareRefName(project.baseRef),
      rootFs,
      project.path,
      exec
    );
    const worktreePoolPath = path.posix.join(await settings.getWorktreeDirectory(), project.name);
    const worktreeHost = new SshWorktreeHost(rootFs);
    await worktreeHost.mkdirAbsolute(worktreePoolPath, { recursive: true });

    return new SshProjectProvider(project, proxy, {
      fs: projectFs,
      worktreeHost,
      settings,
      worktreePoolPath,
    });
  } catch (error) {
    log.warn('createSshProvider: SSH connection failed', {
      projectId: project.id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export class SshProjectProvider implements ProjectProvider {
  readonly type = 'ssh';
  readonly settings: ProjectSettingsProvider;
  readonly repository: GitRepositoryService;
  readonly fs: SshFileSystem;

  private tasks = new Map<string, TaskProvider>();
  private conversationProviders = new Map<string, SshConversationProvider>();
  private terminalProviders = new Map<string, SshTerminalProvider>();
  private provisioningTasks = new Map<string, Promise<Result<TaskProvider, ProvisionTaskError>>>();
  private tearingDownTasks = new Map<string, Promise<Result<void, TeardownTaskError>>>();
  private bootstrapErrors = new Map<string, ProvisionTaskError>();
  private worktreeService: WorktreeService;
  private workspaceRegistry = new WorkspaceRegistry();
  private cachedSftp: SFTPWrapper | undefined;
  private readonly _gitFetchService: GitFetchService;

  constructor(
    private readonly project: SshProject,
    private readonly proxy: SshClientProxy,
    options: {
      fs: SshFileSystem;
      worktreeHost: WorktreeHost;
      settings: ProjectSettingsProvider;
      worktreePoolPath: string;
    }
  ) {
    this.fs = options.fs;
    this.settings = options.settings;
    const gitExec = getGitSshExec(this.proxy, () => githubConnectionService.getToken());
    const repoGit = new GitService(project.path, gitExec, this.fs, false);
    this.repository = new GitRepositoryService(repoGit, this.settings);
    this.worktreeService = new WorktreeService({
      worktreePoolPath: options.worktreePoolPath,
      repoPath: project.path,
      projectSettings: this.settings,
      exec: gitExec,
      host: options.worktreeHost,
    });
    this._gitFetchService = new GitFetchService(repoGit);
    this._gitFetchService.start();
    sshConnectionManager.on('connection-event', this.handleConnectionEvent);
  }

  private handleConnectionEvent = (evt: SshConnectionEvent): void => {
    if (evt.type === 'reconnected' && evt.connectionId === this.project.connectionId) {
      // Re-sync remote-tracking refs as soon as the connection is restored.
      void this._gitFetchService.fetch();
      this.rehydrateTerminals().catch((e: unknown) => {
        log.error('SshProjectProvider: rehydrateTerminals failed after reconnect', {
          projectId: this.project.id,
          connectionId: this.project.connectionId,
          error: String(e),
        });
      });
    }
  };

  private getSftp(): Promise<SFTPWrapper> {
    if (this.cachedSftp) return Promise.resolve(this.cachedSftp);
    return new Promise((resolve, reject) => {
      this.proxy.client.sftp((err, sftp) => {
        if (err) return reject(err);
        this.cachedSftp = sftp;
        sftp.on('close', () => {
          this.cachedSftp = undefined;
        });
        resolve(sftp);
      });
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
        log.error('SshProjectProvider: failed to provision task', {
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
    log.debug('SshProjectProvider: doProvisionTask START', {
      taskId: task.id,
    });

    // Refresh remote-tracking refs in the background so they are as fresh as
    // possible during the lifetime of this task. Non-blocking — provision
    // continues without waiting for the network round-trip.
    void this._gitFetchService.fetch();

    // Sync PRs for this task's branch in the background.
    void prSyncScheduler.onTaskProvisioned(this.project.id, task.taskBranch);

    const workspaceId = workspaceKey(task.taskBranch);
    const workspace = await this.workspaceRegistry.acquire(workspaceId, async () => {
      const workDir = await this.resolveTaskWorkDir(task);
      const workspaceFs = new SshFileSystem(this.proxy, workDir);
      const projectSettings = await this.settings.get();
      const defaultBranch = await this.settings.getDefaultBranch();
      const bootstrapTaskEnvVars = getTaskEnvVars({
        taskId: task.id,
        taskName: task.name,
        taskPath: workDir,
        projectPath: this.project.path,
        defaultBranch,
        portSeed: workDir,
      });
      const tmuxEnabled = projectSettings.tmux ?? false;
      const taskLevelSettings = await getEffectiveTaskSettings({
        projectSettings: this.settings,
        taskFs: workspaceFs,
      });
      const shellSetup = taskLevelSettings.shellSetup ?? projectSettings.shellSetup;
      const scripts = taskLevelSettings.scripts;
      const proxy = this.proxy;
      const exec = getSshExec(proxy);
      const workspaceTerminals = new SshTerminalProvider({
        projectId: this.project.id,
        scopeId: workspaceId,
        taskPath: workDir,
        tmux: tmuxEnabled,
        shellSetup,
        exec,
        proxy,
        taskEnvVars: bootstrapTaskEnvVars,
      });
      const lifecycleService = new WorkspaceLifecycleService({
        projectId: this.project.id,
        workspaceId,
        terminals: workspaceTerminals,
      });
      const workspaceGitExec = getGitSshExec(proxy, () => githubConnectionService.getToken());
      const createdWorkspace: Workspace = {
        id: workspaceId,
        path: workDir,
        fs: workspaceFs,
        git: new GitService(workDir, workspaceGitExec, workspaceFs, false),
        settings: this.settings,
        lifecycleService,
      };

      if (scripts?.setup) {
        void lifecycleService.prepareAndRunLifecycleScript({
          type: 'setup',
          script: scripts.setup,
        });
      }
      if (scripts?.run) {
        void lifecycleService.prepareLifecycleScript({
          type: 'run',
          script: scripts.run,
        });
      }
      if (scripts?.teardown) {
        void lifecycleService.prepareLifecycleScript({
          type: 'teardown',
          script: scripts.teardown,
        });
      }

      return createdWorkspace;
    });

    let provisionSucceeded = false;
    try {
      const projectSettings = await this.settings.get();
      const defaultBranch = await this.settings.getDefaultBranch();
      const taskEnvVars = getTaskEnvVars({
        taskId: task.id,
        taskName: task.name,
        taskPath: workspace.path,
        projectPath: this.project.path,
        defaultBranch,
        portSeed: workspace.path,
      });
      const tmuxEnabled = projectSettings.tmux ?? false;
      const taskLevelSettings = await getEffectiveTaskSettings({
        projectSettings: this.settings,
        taskFs: workspace.fs,
      });
      const shellSetup = taskLevelSettings.shellSetup ?? projectSettings.shellSetup;
      const proxy = this.proxy;
      const exec = getSshExec(proxy);

      const conversationProvider = new SshConversationProvider({
        projectId: this.project.id,
        taskPath: workspace.path,
        taskId: task.id,
        tmux: tmuxEnabled,
        shellSetup,
        exec,
        proxy,
        taskEnvVars,
      });

      const terminalProvider = new SshTerminalProvider({
        projectId: this.project.id,
        scopeId: task.id,
        taskPath: workspace.path,
        tmux: tmuxEnabled,
        shellSetup,
        exec,
        proxy,
        taskEnvVars,
      });

      const taskEnv: TaskProvider = {
        taskId: task.id,
        taskBranch: task.taskBranch,
        sourceBranch: task.sourceBranch,
        taskEnvVars,
        conversations: conversationProvider,
        terminals: terminalProvider,
      };

      Promise.all(
        terminals.map((term) =>
          terminalProvider.spawnTerminal(term).catch((e) => {
            log.error('SshEnvironmentProvider: failed to hydrate terminal', {
              terminalId: term.id,
              error: String(e),
            });
          })
        )
      );

      Promise.all(
        conversations.map((conv) =>
          conversationProvider.startSession(conv, undefined, true).catch((e) => {
            log.error('SshEnvironmentProvider: failed to hydrate conversation', {
              conversationId: conv.id,
              error: String(e),
            });
          })
        )
      );

      this.terminalProviders.set(task.id, terminalProvider);
      this.conversationProviders.set(task.id, conversationProvider);
      log.debug('SshProjectProvider: doProvisionTask DONE', {
        taskId: task.id,
      });
      provisionSucceeded = true;
      return taskEnv;
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
        log.error('SshProjectProvider: failed to teardown task', {
          taskId,
          error: String(e),
        });
        await this.cleanupDetachedTmuxSessions(taskId).catch((cleanupError) => {
          log.warn('SshProjectProvider: fallback tmux cleanup failed', {
            taskId,
            error: String(cleanupError),
          });
        });
        return err<TeardownTaskError>(toTeardownError(e));
      })
      .finally(() => {
        this.tasks.delete(taskId);
        this.tearingDownTasks.delete(taskId);
        this.conversationProviders.delete(taskId);
        this.terminalProviders.delete(taskId);
      });

    this.tearingDownTasks.set(taskId, promise);
    return promise;
  }

  getWorkspace(
    workspaceId: string
  ): import('@main/core/workspaces/workspace').Workspace | undefined {
    return this.workspaceRegistry.get(workspaceId);
  }

  private async doTeardownTask(task: TaskProvider): Promise<void> {
    const wsId = workspaceKey(task.taskBranch);
    const workspace = this.workspaceRegistry.get(wsId);

    if (workspace) {
      const settings = await getEffectiveTaskSettings({
        projectSettings: this.settings,
        taskFs: workspace.fs,
      });
      const scripts = settings.scripts;

      if (scripts?.teardown && this.workspaceRegistry.refCount(wsId) === 1) {
        try {
          const runTeardown = workspace.lifecycleService.runLifecycleScript(
            { type: 'teardown', script: scripts.teardown },
            { waitForExit: true, exit: true }
          );
          await withTimeout(runTeardown, TEARDOWN_SCRIPT_WAIT_MS);
        } catch (error) {
          if (error instanceof TimeoutSignal) {
            log.debug('SshProjectProvider: teardown script wait timed out', {
              taskId: task.taskId,
              timeoutMs: TEARDOWN_SCRIPT_WAIT_MS,
            });
          } else {
            log.warn('SshProjectProvider: teardown script failed (continuing cleanup)', {
              taskId: task.taskId,
              error: String(error),
            });
          }
        }
      }
    }

    await task.conversations.destroyAll();
    await task.terminals.destroyAll();
    await this.workspaceRegistry.release(wsId);
  }

  private async cleanupDetachedTmuxSessions(taskId: string): Promise<void> {
    const { conversationIds, terminalIds } = await getTaskSessionLeafIds(this.project.id, taskId);
    const sessionIds = [...conversationIds, ...terminalIds].map((leafId) =>
      makePtySessionId(this.project.id, taskId, leafId)
    );
    const exec = getSshExec(this.proxy);
    await Promise.all(
      sessionIds.map((sessionId) => killTmuxSession(exec, makeTmuxSessionName(sessionId)))
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
    this._gitFetchService.stop();
    sshConnectionManager.off('connection-event', this.handleConnectionEvent);

    const settings = await this.settings.get();

    if (settings.tmux) {
      await Promise.all(
        Array.from(this.tasks.values()).map((task) =>
          Promise.all([task.conversations.detachAll(), task.terminals.detachAll()])
        )
      );
      this.tasks.clear();
      this.conversationProviders.clear();
      this.terminalProviders.clear();
      await this.workspaceRegistry.releaseAll();
    } else {
      await Promise.all(Array.from(this.tasks.keys()).map((id) => this.teardownTask(id)));
      await this.workspaceRegistry.releaseAll();
    }
  }

  /**
   * Re-spawn all terminal sessions for every active task after an SSH reconnect.
   * Agent sessions are intentionally excluded — they must be restarted manually.
   */
  private async rehydrateTerminals(): Promise<void> {
    await Promise.all(
      Array.from(this.terminalProviders.values()).map((provider) =>
        provider.rehydrate().catch((e: unknown) => {
          log.error('SshEnvironmentProvider: rehydrateTerminals failed for a provider', {
            error: String(e),
          });
        })
      )
    );
  }

  /**
   * Upload local files into the task's working directory via SFTP and return
   * their remote paths.
   */
  async uploadFiles(taskId: string, localPaths: string[]): Promise<string[]> {
    const env = this.tasks.get(taskId);
    if (!env) throw new Error(`No provisioned environment for task: ${taskId}`);

    const sftp = await this.getSftp();
    const wsId = workspaceKey(env.taskBranch);
    const destDir = this.workspaceRegistry.get(wsId)?.path ?? env.taskId;

    return Promise.all(
      localPaths.map(async (localPath) => {
        const remoteName = `${randomUUID()}-${path.basename(localPath)}`;
        const remotePath = `${destDir}/${remoteName}`;
        await new Promise<void>((resolve, reject) => {
          sftp.fastPut(localPath, remotePath, (e) => (e ? reject(e) : resolve()));
        });
        return remotePath;
      })
    );
  }

  async getRemoteState(): Promise<ProjectRemoteState> {
    try {
      const remotes = await this.repository.getRemotes();
      const remoteName = await this.repository.getConfiguredRemote();
      const remoteUrl = remotes.find((r) => r.name === remoteName)?.url;
      return { hasRemote: remotes.length > 0, selectedRemoteUrl: remoteUrl ?? null };
    } catch {
      return { hasRemote: false, selectedRemoteUrl: null };
    }
  }

  private async resolveTaskWorkDir(task: Task): Promise<string> {
    if (!task.taskBranch) {
      return this.project.path;
    }

    const existing = await this.worktreeService.getWorktree(task.taskBranch);
    if (existing) {
      return existing;
    }

    if (!task.sourceBranch || task.taskBranch === task.sourceBranch.branch) {
      const result = await this.worktreeService.checkoutExistingBranch(task.taskBranch);
      if (!result.success) {
        throw mapWorktreeErrorToProvisionError(task.taskBranch, result.error);
      }
      return result.data;
    }

    const result = await this.worktreeService.checkoutBranchWorktree(
      task.sourceBranch,
      task.taskBranch
    );
    if (!result.success) {
      throw mapWorktreeErrorToProvisionError(task.taskBranch, result.error);
    }
    return result.data;
  }
}
