import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { SFTPWrapper } from 'ssh2';
import { Conversation } from '@shared/conversations';
import type { SshProject } from '@shared/projects';
import { err, ok, type Result } from '@shared/result';
import { getTaskEnvVars } from '@shared/task/envVars';
import { Task, type TaskBootstrapStatus } from '@shared/tasks';
import { Terminal } from '@shared/terminals';
import { SshConversationProvider } from '@main/core/conversations/impl/ssh-conversation';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import type { FileSystemProvider } from '@main/core/fs/types';
import { GitService } from '@main/core/git/impl/git-service';
import { bareRefName } from '@main/core/git/impl/git-utils';
import type { GitProvider } from '@main/core/git/types';
import { githubAuthService } from '@main/core/github/services/github-auth-service';
import { SshClientProxy } from '@main/core/ssh/ssh-client-proxy';
import { SshConnectionEvent, sshConnectionManager } from '@main/core/ssh/ssh-connection-manager';
import { TaskLifecycleService } from '@main/core/tasks/task-lifecycle-service';
import { SshTerminalProvider } from '@main/core/terminals/impl/ssh-terminal-provider';
import { getGitSshExec, getSshExec } from '@main/core/utils/exec';
import { log } from '@main/lib/logger';
import type {
  ProjectProvider,
  ProvisionTaskError,
  TaskProvider,
  TeardownTaskError,
} from '../project-provider';
import { SshProjectSettingsProvider } from '../settings/project-settings';
import type { ProjectSettingsProvider } from '../settings/schema';
import { getEffectiveTaskSettings } from '../settings/task-settings';
import { TimeoutSignal, withTimeout } from '../utils';
import { WorktreeService } from '../worktrees/worktree-service';

const TASK_TIMEOUT_MS = 60_000;

function toProvisionError(e: unknown): ProvisionTaskError {
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
    // hardcoded to next to project path, TODO: let user configure path
    const worktreePoolPath = path.join(path.dirname(project.path), 'worktrees', project.name);
    return new SshProjectProvider(project, rootFs, proxy, {
      worktreePoolPath: worktreePoolPath,
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
  readonly git: GitProvider;
  readonly fs: SshFileSystem;

  private tasks = new Map<string, TaskProvider>();
  private conversationProviders = new Map<string, SshConversationProvider>();
  private terminalProviders = new Map<string, SshTerminalProvider>();
  private provisioningTasks = new Map<string, Promise<Result<TaskProvider, ProvisionTaskError>>>();
  private tearingDownTasks = new Map<string, Promise<Result<void, TeardownTaskError>>>();
  private bootstrapErrors = new Map<string, ProvisionTaskError>();
  private worktreeService: WorktreeService;
  private cachedSftp: SFTPWrapper | undefined;

  constructor(
    private readonly project: SshProject,
    rootFs: FileSystemProvider,
    private readonly proxy: SshClientProxy,
    options: {
      worktreePoolPath: string;
    }
  ) {
    this.fs = new SshFileSystem(this.proxy, project.path);
    this.settings = new SshProjectSettingsProvider(this.fs, bareRefName(project.baseRef));
    const gitExec = getGitSshExec(this.proxy, () => githubAuthService.getToken());
    this.git = new GitService(project.path, gitExec, this.fs);
    this.worktreeService = new WorktreeService({
      worktreePoolPath: options.worktreePoolPath,
      repoPath: project.path,
      projectSettings: this.settings,
      exec: gitExec,
      rootFs: rootFs,
    });
    sshConnectionManager.on('connection-event', this.handleConnectionEvent);
  }

  private handleConnectionEvent = (evt: SshConnectionEvent): void => {
    if (evt.type === 'reconnected' && evt.connectionId === this.project.connectionId) {
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

    let workDir: string;

    if (task.taskBranch) {
      const existing = await this.worktreeService.getWorktree(task.taskBranch);
      if (existing) {
        workDir = existing;
      } else if (task.taskBranch === task.sourceBranch) {
        const result = await this.worktreeService.checkoutExistingBranch(task.taskBranch);
        if (!result.success) {
          switch (result.error.type) {
            case 'branch-not-found':
              throw new Error(`Branch "${task.taskBranch}" was not found locally or on remote`);
            case 'worktree-setup-failed': {
              const causeMsg =
                result.error.cause instanceof Error
                  ? result.error.cause.message
                  : String(result.error.cause);
              throw new Error(
                `Failed to set up worktree for branch "${task.taskBranch}": ${causeMsg}`
              );
            }
            default:
              throw new Error(`Failed to set up worktree for branch "${task.taskBranch}"`);
          }
        }
        workDir = result.data;
      } else {
        const result = await this.worktreeService.serveWorktree(task.sourceBranch, task.taskBranch);
        if (!result.success) {
          switch (result.error.type) {
            case 'reserve-failed':
              throw new Error(`Could not prepare worktree for branch "${task.sourceBranch}"`);
            case 'worktree-setup-failed':
              throw new Error(`Failed to set up worktree for task`);
            default:
              throw new Error(`Failed to set up worktree for task`);
          }
        }
        workDir = result.data;
      }
    } else {
      workDir = this.project.path;
    }

    const taskFs = new SshFileSystem(this.proxy, workDir);
    const projectSettings = await this.settings.get();
    const defaultBranch = await this.settings.getDefaultBranch();
    const taskEnvVars = getTaskEnvVars({
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
      taskFs,
    });
    const shellSetup = taskLevelSettings.shellSetup ?? projectSettings.shellSetup;
    const scripts = taskLevelSettings.scripts;
    const proxy = this.proxy;

    const taskGitExec = getGitSshExec(proxy, () => githubAuthService.getToken());
    const exec = getSshExec(proxy);
    const taskGit = new GitService(workDir, taskGitExec, taskFs);
    const conversationProvider = new SshConversationProvider({
      projectId: this.project.id,
      taskPath: workDir,
      taskId: task.id,
      tmux: tmuxEnabled,
      shellSetup,
      exec,
      proxy,
      taskEnvVars,
    });

    const terminalProvider = new SshTerminalProvider({
      projectId: this.project.id,
      taskId: task.id,
      taskPath: workDir,
      tmux: tmuxEnabled,
      shellSetup,
      exec,
      proxy,
      taskEnvVars,
    });

    const taskLifecycleService = new TaskLifecycleService({
      projectId: this.project.id,
      taskId: task.id,
      terminals: terminalProvider,
    });

    const taskEnv: TaskProvider = {
      taskId: task.id,
      taskPath: workDir,
      taskBranch: task.taskBranch,
      sourceBranch: task.sourceBranch,
      taskEnvVars,
      fs: taskFs,
      git: taskGit,
      conversations: conversationProvider,
      terminals: terminalProvider,
      settings: this.settings,
      lifecycleService: taskLifecycleService,
    };

    if (scripts?.setup) {
      void taskLifecycleService.prepareAndRunLifecycleScript({
        type: 'setup',
        script: scripts.setup,
      });
    }

    if (scripts?.run) {
      void taskLifecycleService.prepareAndRunLifecycleScript({
        type: 'run',
        script: scripts.run,
      });
    }

    if (scripts?.teardown) {
      void taskLifecycleService.prepareLifecycleScript({
        type: 'teardown',
        script: scripts.teardown,
      });
    }

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
    return taskEnv;
  }

  getTask(taskId: string): TaskProvider | undefined {
    return this.tasks.get(taskId);
  }

  getTaskBootstrapStatus(taskId: string): TaskBootstrapStatus {
    if (this.tasks.has(taskId)) return { status: 'ready' };
    if (this.provisioningTasks.has(taskId)) return { status: 'bootstrapping' };
    const bootstrapError = this.bootstrapErrors.get(taskId);
    if (bootstrapError) return { status: 'error', message: bootstrapError.message };
    return { status: 'not-started' };
  }

  async teardownTask(taskId: string): Promise<Result<void, TeardownTaskError>> {
    if (this.tearingDownTasks.has(taskId)) return this.tearingDownTasks.get(taskId)!;
    const task = this.tasks.get(taskId);
    if (!task) return ok();

    const promise = withTimeout(this.doTeardownTask(task), TASK_TIMEOUT_MS)
      .then(() => ok<void>())
      .catch((e) => {
        log.error('SshProjectProvider: failed to teardown task', {
          taskId,
          error: String(e),
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

  private async doTeardownTask(task: TaskProvider): Promise<void> {
    const settings = await getEffectiveTaskSettings({
      projectSettings: this.settings,
      taskFs: task.fs,
    });

    const scripts = settings.scripts;

    if (scripts?.teardown && task.lifecycleService) {
      await task.lifecycleService.runLifecycleScript(
        {
          type: 'teardown',
          script: scripts.teardown,
        },
        { waitForExit: true, exit: true }
      );
    }

    await task.conversations.destroyAll();
    await task.terminals.destroyAll();
  }

  async removeTaskWorktree(taskBranch: string): Promise<void> {
    const worktreePath = await this.worktreeService.getWorktree(taskBranch);
    if (worktreePath) {
      await this.worktreeService.removeWorktree(worktreePath);
    }
  }

  async cleanup(): Promise<void> {
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
    } else {
      await Promise.all(Array.from(this.tasks.keys()).map((id) => this.teardownTask(id)));
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
    const destDir = env.taskPath;

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
}
