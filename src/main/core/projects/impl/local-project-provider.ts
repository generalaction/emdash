import fs from 'node:fs';
import path from 'node:path';
import { Conversation } from '@shared/conversations';
import { bareRefName } from '@shared/git-utils';
import { LocalProject } from '@shared/projects';
import { makePtySessionId } from '@shared/ptySessionId';
import { err, ok, type Result } from '@shared/result';
import { getTaskEnvVars } from '@shared/task/envVars';
import { Task, type TaskBootstrapStatus } from '@shared/tasks';
import { type Terminal } from '@shared/terminals';
import { workspaceKey } from '@shared/workspace-key';
import { LocalConversationProvider } from '@main/core/conversations/impl/local-conversation';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import type { FileSystemProvider } from '@main/core/fs/types';
import { GitWatcherService } from '@main/core/git/git-watcher-service';
import { GitService } from '@main/core/git/impl/git-service';
import { GitRepositoryService } from '@main/core/git/repository-service';
import { githubConnectionService } from '@main/core/github/services/github-connection-service';
import { killTmuxSession, makeTmuxSessionName } from '@main/core/pty/tmux-session-name';
import { appSettingsService } from '@main/core/settings/settings-service';
import { getTaskSessionLeafIds } from '@main/core/tasks/session-targets';
import { LocalTerminalProvider } from '@main/core/terminals/impl/local-terminal-provider';
import { getGitLocalExec, getLocalExec } from '@main/core/utils/exec';
import type { Workspace } from '@main/core/workspaces/workspace';
import { WorkspaceLifecycleService } from '@main/core/workspaces/workspace-lifecycle-service';
import { WorkspaceRegistry } from '@main/core/workspaces/workspace-registry';
import { log } from '@main/lib/logger';
import type {
  ProjectProvider,
  ProjectRemoteState,
  ProvisionTaskError,
  TaskProvider,
  TeardownTaskError,
} from '../project-provider';
import { LocalProjectSettingsProvider } from '../settings/project-settings';
import type { ProjectSettingsProvider } from '../settings/schema';
import { getEffectiveTaskSettings } from '../settings/task-settings';
import { TimeoutSignal, withTimeout } from '../utils';
import { WorktreeService } from '../worktrees/worktree-service';

const TASK_TIMEOUT_MS = 60_000;
const TEARDOWN_SCRIPT_WAIT_MS = 10_000;

function toProvisionError(e: unknown): ProvisionTaskError {
  if (e instanceof TimeoutSignal) return { type: 'timeout', message: e.message, timeout: e.ms };
  return { type: 'error', message: e instanceof Error ? e.message : String(e) };
}

function toTeardownError(e: unknown): TeardownTaskError {
  if (e instanceof TimeoutSignal) return { type: 'timeout', message: e.message, timeout: e.ms };
  return { type: 'error', message: e instanceof Error ? e.message : String(e) };
}

export async function createLocalProvider(
  project: LocalProject,
  rootFs: FileSystemProvider
): Promise<LocalProjectProvider> {
  const defaultWorktreeDirectory = (await appSettingsService.get('localProject'))
    .defaultWorktreeDirectory;
  const worktreePoolPath = path.join(defaultWorktreeDirectory, project.name);

  await fs.promises.mkdir(worktreePoolPath, { recursive: true });

  return new LocalProjectProvider(project, rootFs, { worktreePoolPath });
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

  constructor(
    private readonly project: LocalProject,
    readonly rootFs: FileSystemProvider,
    options: {
      worktreePoolPath: string;
    }
  ) {
    this.settings = new LocalProjectSettingsProvider(project.path, bareRefName(project.baseRef));
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
    log.debug('LocalProjectProvider: doProvisionTask START', {
      taskId: task.id,
    });

    const workspaceId = workspaceKey(task.taskBranch);
    const workspace = await this.workspaceRegistry.acquire(workspaceId, async () => {
      const workDir = await this.resolveTaskWorkDir(task);
      const exec = getGitLocalExec(() => githubConnectionService.getToken());
      const workspaceFs = new LocalFileSystem(workDir);

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

      const workspaceTerminals = new LocalTerminalProvider({
        projectId: this.project.id,
        scopeId: workspaceId,
        taskPath: workDir,
        tmux: tmuxEnabled,
        shellSetup,
        exec,
        taskEnvVars: bootstrapTaskEnvVars,
      });
      const lifecycleService = new WorkspaceLifecycleService({
        projectId: this.project.id,
        workspaceId,
        terminals: workspaceTerminals,
      });

      const createdWorkspace: Workspace = {
        id: workspaceId,
        path: workDir,
        fs: workspaceFs,
        git: new GitService(workDir, exec, workspaceFs),
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

    // Register the workspace with the git watcher so that index/HEAD changes
    // in its worktree git dir are emitted as granular workspace events.
    const mainDotGitAbs = path.resolve(this.project.path, '.git');
    const relativeGitDir = await workspace.git.getWorktreeGitDir(mainDotGitAbs);
    this._gitWatcher.registerWorktree(workspaceId, relativeGitDir);

    let provisionSucceeded = false;
    try {
      const exec = getGitLocalExec(() => githubConnectionService.getToken());
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

      const conversationProvider = new LocalConversationProvider({
        projectId: this.project.id,
        taskPath: workspace.path,
        taskId: task.id,
        tmux: tmuxEnabled,
        shellSetup,
        exec,
        taskEnvVars,
      });

      const terminalProvider = new LocalTerminalProvider({
        projectId: this.project.id,
        scopeId: task.id,
        taskPath: workspace.path,
        tmux: tmuxEnabled,
        shellSetup,
        exec,
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
            log.error('LocalEnvironmentProvider: failed to hydrate terminal', {
              terminalId: term.id,
              error: String(e),
            });
          })
        )
      );

      Promise.all(
        conversations.map((conv) =>
          conversationProvider.startSession(conv, undefined, true).catch((e) => {
            log.error('LocalEnvironmentProvider: failed to hydrate conversation', {
              conversationId: conv.id,
              error: String(e),
            });
          })
        )
      );

      log.debug('LocalProjectProvider: doProvisionTask DONE', {
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
    if (bootstrapError) return { status: 'error', message: bootstrapError.message };
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
            log.debug('LocalProjectProvider: teardown script wait timed out', {
              taskId: task.taskId,
              timeoutMs: TEARDOWN_SCRIPT_WAIT_MS,
            });
          } else {
            log.warn('LocalProjectProvider: teardown script failed (continuing cleanup)', {
              taskId: task.taskId,
              error: String(error),
            });
          }
        }
      }
    }

    await task.conversations.destroyAll();
    await task.terminals.destroyAll();
    if (this.workspaceRegistry.refCount(wsId) <= 1) {
      this._gitWatcher.unregisterWorktree(wsId);
    }
    await this.workspaceRegistry.release(wsId);
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

  async removeTaskWorktree(taskBranch: string): Promise<void> {
    const worktreePath = await this.worktreeService.getWorktree(taskBranch);
    if (worktreePath) {
      await this.worktreeService.removeWorktree(worktreePath);
    }
  }

  async cleanup(): Promise<void> {
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

  private async resolveTaskWorkDir(task: Task): Promise<string> {
    if (!task.taskBranch) {
      return this.project.path;
    }

    const existing = await this.worktreeService.getWorktree(task.taskBranch);
    if (existing) {
      return existing;
    }

    if (task.taskBranch === task.sourceBranch) {
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
      return result.data;
    }

    const result = await this.worktreeService.serveWorktree(task.sourceBranch, task.taskBranch);
    if (!result.success) {
      switch (result.error.type) {
        case 'reserve-failed':
          throw new Error(`Could not prepare worktree for branch "${task.sourceBranch}"`);
        case 'worktree-setup-failed':
          throw new Error('Failed to set up worktree for task');
        default:
          throw new Error('Failed to set up worktree for task');
      }
    }
    return result.data;
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
}
