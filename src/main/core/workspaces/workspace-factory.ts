import { getTaskEnvVars } from '@shared/task/envVars';
import type { Task } from '@shared/tasks';
import { LocalConversationProvider } from '@main/core/conversations/impl/local-conversation';
import { SshConversationProvider } from '@main/core/conversations/impl/ssh-conversation';
import type { ConversationProvider } from '@main/core/conversations/types';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import { GitFetchService } from '@main/core/git/git-fetch-service';
import { GitService } from '@main/core/git/impl/git-service';
import { GitRepositoryService } from '@main/core/git/repository-service';
import { githubConnectionService } from '@main/core/github/services/github-connection-service';
import type { SshClientProxy } from '@main/core/ssh/ssh-client-proxy';
import { LocalTerminalProvider } from '@main/core/terminals/impl/local-terminal-provider';
import { SshTerminalProvider } from '@main/core/terminals/impl/ssh-terminal-provider';
import type { TerminalProvider } from '@main/core/terminals/terminal-provider';
import { getGitLocalExec, getGitSshExec, getSshExec } from '@main/core/utils/exec';
import type { Workspace } from '@main/core/workspaces/workspace';
import { LifecycleScriptService } from '@main/core/workspaces/workspace-lifecycle-service';
import { type WorkspaceFactoryResult } from '@main/core/workspaces/workspace-registry';
import { log } from '@main/lib/logger';
import type { ProjectSettingsProvider } from '../projects/settings/schema';
import { getEffectiveTaskSettings } from '../projects/settings/task-settings';
import { TimeoutSignal, withTimeout } from '../projects/utils';
import { TEARDOWN_SCRIPT_WAIT_MS } from '../tasks/provision-task-error';

export type WorkspaceType =
  | { kind: 'local' }
  | { kind: 'ssh'; proxy: SshClientProxy; connectionId: string };

type WorkspaceFactoryContext = {
  task: Pick<Task, 'id' | 'name'>;
  workDir: string;
  projectId: string;
  projectPath: string;
  settings: ProjectSettingsProvider;
  logPrefix: string;
  /** Inject an existing repository service (e.g. the project-level singleton).
   *  When absent, the factory creates a fresh instance from the workspace's GitService. */
  repository?: GitRepositoryService;
  /** Inject an existing fetch service. When absent, the factory creates and manages one.
   *  Lifecycle (start/stop) is only managed by the factory when it creates the instance. */
  fetchService?: GitFetchService;
  extraHooks?: {
    onCreate?: (ws: Workspace) => Promise<void>;
    onDestroy?: (ws: Workspace) => Promise<void>;
    onDetach?: (ws: Workspace) => Promise<void>;
  };
};

/**
 * Returns a factory function suitable for passing to `WorkspaceRegistry.acquire`.
 * Handles all transport-specific construction (local vs SSH) and wires lifecycle
 * script hooks. Provider-specific hooks (e.g. git watcher) are passed via `extraHooks`.
 */
export function createWorkspaceFactory(
  workspaceId: string,
  type: WorkspaceType,
  context: WorkspaceFactoryContext
): () => Promise<WorkspaceFactoryResult> {
  return async () => {
    const workDir = context.workDir;

    // Transport-specific FS, exec, and git exec
    const workspaceFs =
      type.kind === 'ssh' ? new SshFileSystem(type.proxy, workDir) : new LocalFileSystem(workDir);

    const exec =
      type.kind === 'ssh'
        ? getSshExec(type.proxy)
        : getGitLocalExec(() => githubConnectionService.getToken());

    const gitExec =
      type.kind === 'ssh'
        ? getGitSshExec(type.proxy, () => githubConnectionService.getToken())
        : exec;

    // Settings (shared)
    const projectSettings = await context.settings.get();
    const defaultBranch = await context.settings.getDefaultBranch();
    const bootstrapTaskEnvVars = getTaskEnvVars({
      taskId: context.task.id,
      taskName: context.task.name,
      taskPath: workDir,
      projectPath: context.projectPath,
      defaultBranch,
      portSeed: workDir,
    });
    const tmuxEnabled = projectSettings.tmux ?? false;
    const taskLevelSettings = await getEffectiveTaskSettings({
      projectSettings: context.settings,
      taskFs: workspaceFs,
    });
    const shellSetup = taskLevelSettings.shellSetup ?? projectSettings.shellSetup;
    const scripts = taskLevelSettings.scripts;

    // Transport-specific workspace terminal provider (used only by lifecycle scripts)
    const workspaceTerminals =
      type.kind === 'ssh'
        ? new SshTerminalProvider({
            projectId: context.projectId,
            scopeId: workspaceId,
            taskPath: workDir,
            tmux: tmuxEnabled,
            shellSetup,
            exec,
            proxy: type.proxy,
            connectionId: type.connectionId,
            taskEnvVars: bootstrapTaskEnvVars,
          })
        : new LocalTerminalProvider({
            projectId: context.projectId,
            scopeId: workspaceId,
            taskPath: workDir,
            tmux: tmuxEnabled,
            shellSetup,
            exec,
            taskEnvVars: bootstrapTaskEnvVars,
          });

    const lifecycleService = new LifecycleScriptService({
      projectId: context.projectId,
      workspaceId,
      terminals: workspaceTerminals,
    });

    const gitService = new GitService(
      workDir,
      gitExec,
      workspaceFs,
      type.kind === 'ssh' ? false : undefined
    );

    const repository = context.repository ?? new GitRepositoryService(gitService, context.settings);

    const ownsFetchService = !context.fetchService;
    const fetchService =
      context.fetchService ??
      new GitFetchService(
        gitService,
        async () => (await githubConnectionService.getToken()) !== null
      );

    const workspace: Workspace = {
      id: workspaceId,
      path: workDir,
      fs: workspaceFs,
      git: gitService,
      settings: context.settings,
      lifecycleService,
      repository,
      fetchService,
    };

    const { logPrefix } = context;

    return {
      workspace,

      onCreateSideEffect: (ws) => {
        if (ownsFetchService) {
          fetchService.start();
        }
        if (scripts?.setup) {
          void ws.lifecycleService.prepareAndRunLifecycleScript({
            type: 'setup',
            script: scripts.setup,
          });
        }
        if (scripts?.run) {
          void ws.lifecycleService.prepareLifecycleScript({ type: 'run', script: scripts.run });
        }
        if (scripts?.teardown) {
          void ws.lifecycleService.prepareLifecycleScript({
            type: 'teardown',
            script: scripts.teardown,
          });
        }
      },

      onCreate: context.extraHooks?.onCreate,

      onDestroy: async (ws) => {
        if (ownsFetchService) {
          fetchService.stop();
        }
        if (scripts?.teardown) {
          try {
            await withTimeout(
              ws.lifecycleService.runLifecycleScript(
                { type: 'teardown', script: scripts.teardown },
                { waitForExit: true, exit: true }
              ),
              TEARDOWN_SCRIPT_WAIT_MS
            );
          } catch (error) {
            if (error instanceof TimeoutSignal) {
              log.debug(`${logPrefix}: teardown script wait timed out`, {
                workspaceId,
                timeoutMs: TEARDOWN_SCRIPT_WAIT_MS,
              });
            } else {
              log.warn(`${logPrefix}: teardown script failed (continuing cleanup)`, {
                workspaceId,
                error: String(error),
              });
            }
          }
        }
        await context.extraHooks?.onDestroy?.(ws);
      },

      onDetach: context.extraHooks?.onDetach
        ? (ws) => context.extraHooks!.onDetach!(ws)
        : undefined,
    };
  };
}

type TaskProviderOpts = {
  projectId: string;
  taskId: string;
  taskPath: string;
  tmuxEnabled: boolean;
  shellSetup?: string;
  taskEnvVars: Record<string, string>;
};

/**
 * Creates task-scoped conversation and terminal providers for the given transport type.
 * The exec function is derived internally from the WorkspaceType.
 */
export function buildTaskProviders(
  type: WorkspaceType,
  opts: TaskProviderOpts
): { conversations: ConversationProvider; terminals: TerminalProvider } {
  if (type.kind === 'ssh') {
    const exec = getSshExec(type.proxy);
    return {
      conversations: new SshConversationProvider({
        projectId: opts.projectId,
        taskPath: opts.taskPath,
        taskId: opts.taskId,
        tmux: opts.tmuxEnabled,
        shellSetup: opts.shellSetup,
        exec,
        proxy: type.proxy,
        taskEnvVars: opts.taskEnvVars,
      }),
      terminals: new SshTerminalProvider({
        projectId: opts.projectId,
        scopeId: opts.taskId,
        taskPath: opts.taskPath,
        tmux: opts.tmuxEnabled,
        shellSetup: opts.shellSetup,
        exec,
        proxy: type.proxy,
        connectionId: type.connectionId,
        taskEnvVars: opts.taskEnvVars,
      }),
    };
  }

  const exec = getGitLocalExec(() => githubConnectionService.getToken());
  return {
    conversations: new LocalConversationProvider({
      projectId: opts.projectId,
      taskPath: opts.taskPath,
      taskId: opts.taskId,
      tmux: opts.tmuxEnabled,
      shellSetup: opts.shellSetup,
      exec,
      taskEnvVars: opts.taskEnvVars,
    }),
    terminals: new LocalTerminalProvider({
      projectId: opts.projectId,
      scopeId: opts.taskId,
      taskPath: opts.taskPath,
      tmux: opts.tmuxEnabled,
      shellSetup: opts.shellSetup,
      exec,
      taskEnvVars: opts.taskEnvVars,
    }),
  };
}

/**
 * Resolves the task-level environment variables and settings from an already-acquired workspace.
 * Used by providers after `workspaceRegistry.acquire` to avoid duplicating settings reads.
 */
export async function resolveTaskEnv(
  task: Pick<Task, 'id' | 'name'>,
  workspace: Pick<Workspace, 'path' | 'fs'>,
  projectPath: string,
  settings: ProjectSettingsProvider
): Promise<{
  taskEnvVars: Record<string, string>;
  tmuxEnabled: boolean;
  shellSetup?: string;
}> {
  const projectSettings = await settings.get();
  const defaultBranch = await settings.getDefaultBranch();
  const taskLevelSettings = await getEffectiveTaskSettings({
    projectSettings: settings,
    taskFs: workspace.fs,
  });
  return {
    taskEnvVars: getTaskEnvVars({
      taskId: task.id,
      taskName: task.name,
      taskPath: workspace.path,
      projectPath,
      defaultBranch,
      portSeed: workspace.path,
    }),
    tmuxEnabled: projectSettings.tmux ?? false,
    shellSetup: taskLevelSettings.shellSetup ?? projectSettings.shellSetup,
  };
}
