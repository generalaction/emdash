import fs from 'node:fs';
import path from 'node:path';
import { Conversation } from '@shared/conversations';
import { LocalProject } from '@shared/projects';
import { err, ok, type Result } from '@shared/result';
import { getTaskEnvVars } from '@shared/task/envVars';
import { Task, type TaskBootstrapStatus } from '@shared/tasks';
import { type Terminal } from '@shared/terminals';
import { HookConfigWriter } from '@main/core/agent-hooks/hook-config';
import { LocalConversationProvider } from '@main/core/conversations/impl/local-conversation';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import type { FileSystemProvider } from '@main/core/fs/types';
import { GitService } from '@main/core/git/impl/git-service';
import { bareRefName } from '@main/core/git/impl/git-utils';
import type { GitProvider } from '@main/core/git/types';
import { appSettingsService } from '@main/core/settings/settings-service';
import { TaskLifecycleService } from '@main/core/tasks/task-lifecycle-service';
import { LocalTerminalProvider } from '@main/core/terminals/impl/local-terminal-provider';
import { getLocalExec } from '@main/core/utils/exec';
import { log } from '@main/lib/logger';
import type {
  ProjectProvider,
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
  readonly git: GitProvider;
  readonly fs: FileSystemProvider;

  private tasks = new Map<string, TaskProvider>();
  private provisioningTasks = new Map<string, Promise<Result<TaskProvider, ProvisionTaskError>>>();
  private tearingDownTasks = new Map<string, Promise<Result<void, TeardownTaskError>>>();
  private bootstrapErrors = new Map<string, ProvisionTaskError>();
  private worktreeService: WorktreeService;

  constructor(
    private readonly project: LocalProject,
    readonly rootFs: FileSystemProvider,
    options: {
      worktreePoolPath: string;
    }
  ) {
    this.settings = new LocalProjectSettingsProvider(project.path, bareRefName(project.baseRef));
    this.fs = new LocalFileSystem(project.path);
    this.git = new GitService(project.path, getLocalExec(), this.fs);
    this.worktreeService = new WorktreeService({
      worktreePoolPath: options.worktreePoolPath,
      repoPath: project.path,
      projectSettings: this.settings,
      exec: getLocalExec(),
      rootFs: rootFs,
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
    log.debug('LocalProjectProvider: doProvisionTask START', {
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

    const taskFs = new LocalFileSystem(workDir);
    await new HookConfigWriter(taskFs).writeAll();

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

    const exec = getLocalExec();
    const taskGit = new GitService(workDir, exec, taskFs);
    const conversationProvider = new LocalConversationProvider({
      projectId: this.project.id,
      taskPath: workDir,
      taskId: task.id,
      tmux: tmuxEnabled,
      shellSetup,
      exec,
      taskEnvVars,
    });

    const terminalProvider = new LocalTerminalProvider({
      projectId: this.project.id,
      taskId: task.id,
      taskPath: workDir,
      tmux: tmuxEnabled,
      shellSetup,
      exec,
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
      void taskLifecycleService.runLifecycleScript({ type: 'setup', script: scripts.setup });
    }

    if (scripts?.run) {
      void taskLifecycleService.runLifecycleScript({ type: 'run', script: scripts.run });
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
        log.error('LocalProjectProvider: failed to teardown task', {
          taskId,
          error: String(e),
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

  private async doTeardownTask(task: TaskProvider): Promise<void> {
    const settings = await getEffectiveTaskSettings({
      projectSettings: this.settings,
      taskFs: task.fs,
    });
    const scripts = settings.scripts;

    if (scripts?.teardown && task.lifecycleService) {
      await task.lifecycleService.executeLifecycleScript(
        { type: 'teardown', script: scripts.teardown },
        { exit: true }
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
    const settings = await this.settings.get();

    if (settings.tmux) {
      await Promise.all(
        Array.from(this.tasks.values()).map((task) =>
          Promise.all([task.conversations.detachAll(), task.terminals.detachAll()])
        )
      );
      this.tasks.clear();
    } else {
      await Promise.all(Array.from(this.tasks.keys()).map((id) => this.teardownTask(id)));
    }
  }
}
