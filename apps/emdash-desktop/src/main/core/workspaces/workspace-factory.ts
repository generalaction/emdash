import path from 'node:path';
import { LocalConversationProvider } from '@main/core/conversations/impl/local-conversation';
import { SshConversationProvider } from '@main/core/conversations/impl/ssh-conversation';
import type { ConversationProvider } from '@main/core/conversations/types';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { SshExecutionContext } from '@main/core/execution-context/ssh-execution-context';
import { FileTreeProjector } from '@main/core/files/file-tree/projector';
import { GitRepositoryFetchService } from '@main/core/git/repository/fetch-service';
import { GitRepositoryService } from '@main/core/git/repository/service';
import { previewServerService } from '@main/core/preview-servers/preview-server-service-instance';
import { invalidateLegacySshGitWorktreeStatus } from '@main/core/runtime/legacy/ssh-git';
import type { IFilesRuntime } from '@main/core/runtime/types';
import type { MachineRef, RuntimeManager } from '@main/core/runtime/types';
import { workspaceFileIndexService } from '@main/core/search/workspace-file-index-service';
import { appSettingsService } from '@main/core/settings/settings-service';
import type { SshClientProxy } from '@main/core/ssh/lifecycle/ssh-client-proxy';
import { resolveLocalAutomationShellWithSystemFallback } from '@main/core/terminal-shell/resolver';
import type { ResolvedShellProfile } from '@main/core/terminal-shell/types';
import { LocalTerminalProvider } from '@main/core/terminals/impl/local-terminal-provider';
import { SshTerminalProvider } from '@main/core/terminals/impl/ssh-terminal-provider';
import { runLifecycleScriptWithPolicy } from '@main/core/terminals/lifecycle-script-coordinator';
import type { TerminalProvider } from '@main/core/terminals/terminal-provider';
import type { Workspace } from '@main/core/workspaces/workspace';
import { LifecycleScriptService } from '@main/core/workspaces/workspace-lifecycle-service';
import { type WorkspaceFactoryResult } from '@main/core/workspaces/workspace-registry';
import { handleGitWorktreeUpdate } from '@main/core/workspaces/workspace-worktree-update';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { fileChangesChannel, fileTreeProjectionChannel } from '@shared/core/fs/fsEvents';
import { gitWorktreeUpdateChannel } from '@shared/core/git/events';
import type { Task } from '@shared/core/tasks/tasks';
import { getEffectiveTaskSettings } from '../projects/settings/effective-task-settings';
import type { ProjectSettingsProvider } from '../projects/settings/provider';
import { TEARDOWN_SCRIPT_WAIT_MS } from '../tasks/provision-task-error';
import { getTaskEnvVars } from './workspace-env';

export type WorkspaceType =
  | { kind: 'local' }
  | { kind: 'ssh'; proxy: SshClientProxy; connectionId: string };

type WorkspaceFactoryContext = {
  task: Pick<Task, 'id' | 'name'>;
  workDir: string;
  projectId: string;
  projectPath: string;
  workspaceRuntime: {
    machine: MachineRef;
    manager: Pick<RuntimeManager, 'acquire'>;
  };
  settings: ProjectSettingsProvider;
  logPrefix: string;
  /** Inject an existing repository service (e.g. the project-level singleton). */
  gitRepository?: GitRepositoryService;
  /** Inject an existing fetch service. When absent, the factory creates and manages one.
   *  Lifecycle (start/stop) is only managed by the factory when it creates the instance. */
  gitRepositoryFetchService?: GitRepositoryFetchService;
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

    const ctx =
      type.kind === 'ssh'
        ? new SshExecutionContext(type.proxy, { connectionId: type.connectionId })
        : new LocalExecutionContext();

    const runtime = await acquireWorkspaceRuntime(context.workspaceRuntime, workDir);
    const { gitWorktree, fileTree, filesRuntime } = runtime;
    const openedFileSystem = filesRuntime.fileSystem();
    if (!openedFileSystem.success) {
      await runtime.release();
      throw new Error(`Failed to open file system: ${openedFileSystem.error.message}`);
    }
    const fileSystem = openedFileSystem.data;
    const configPath = filesRuntime.path.join(workDir, '.emdash.json');

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
      taskFs: fileSystem,
      taskConfigPath: configPath,
    });
    const shellSetup = taskLevelSettings.shellSetup ?? projectSettings.shellSetup;
    const scripts = taskLevelSettings.scripts;

    // Transport-specific workspace terminal provider (used only by lifecycle scripts)
    const workspaceTerminals =
      type.kind === 'ssh'
        ? new SshTerminalProvider({
            projectId: context.projectId,
            workspaceId,
            scopeId: workspaceId,
            taskPath: workDir,
            tmux: tmuxEnabled,
            shellSetup,
            ctx,
            proxy: type.proxy,
            connectionId: type.connectionId,
            taskEnvVars: bootstrapTaskEnvVars,
          })
        : new LocalTerminalProvider({
            projectId: context.projectId,
            workspaceId,
            scopeId: workspaceId,
            taskPath: workDir,
            tmux: tmuxEnabled,
            shellSetup,
            ctx,
            taskEnvVars: bootstrapTaskEnvVars,
          });

    const lifecycleService = new LifecycleScriptService({
      projectId: context.projectId,
      workspaceId,
      terminals: workspaceTerminals,
    });

    const gitRepository =
      context.gitRepository ?? new GitRepositoryService(gitWorktree.repository, context.settings);

    const ownsFetchService = !context.gitRepositoryFetchService;
    const gitRepositoryFetchService =
      context.gitRepositoryFetchService ??
      new GitRepositoryFetchService(gitRepository, () => gitRepository.getBaseRemote());
    let unsubscribeGitUpdates: (() => void) | undefined;
    let unsubscribeFileChanges: (() => void) | undefined;

    const fileTreeProjector = new FileTreeProjector(fileTree, (update) =>
      events.emit(fileTreeProjectionChannel, {
        projectId: context.projectId,
        workspaceId,
        subscriptionId: update.subscriptionId,
        version: update.version,
        scopes: update.scopes,
      })
    );

    const workspace: Workspace = {
      id: workspaceId,
      path: workDir,
      configPath,
      fileSystem,
      fileTree,
      fileTreeProjector,
      gitWorktree,
      settings: context.settings,
      lifecycleService,
      gitRepository,
      gitRepositoryFetchService,
      dispose: async () => {
        unsubscribeGitUpdates?.();
        unsubscribeGitUpdates = undefined;
        fileTreeProjector.dispose();
        unsubscribeFileChanges?.();
        unsubscribeFileChanges = undefined;
        await runtime.release();
      },
    };

    const { logPrefix } = context;

    return {
      workspace,
      sshFilesRuntime: type.kind === 'ssh' ? filesRuntime : undefined,

      onCreateSideEffect: (ws) => {
        void workspaceFileIndexService.onWorkspaceActivated(workspaceId, {
          rootPath: ws.path,
          enumerate: (root, options) => {
            const fs = filesRuntime.fileSystem();
            return fs.success ? fs.data.enumerate(root, options) : fs;
          },
          listGitFiles: async () => {
            const relativePaths = await ws.gitWorktree.listIndexableFiles();
            return relativePaths.map((relativePath) => path.join(ws.path, relativePath));
          },
        });
        unsubscribeGitUpdates = ws.gitWorktree.subscribe((update) =>
          handleGitWorktreeUpdate(workspaceId, update, (emitted) => {
            events.emit(gitWorktreeUpdateChannel, {
              projectId: context.projectId,
              workspaceId,
              update: emitted,
            });
          })
        );
        const fileChanges = filesRuntime.watchChanges(workDir, (update) => {
          if (type.kind === 'ssh') {
            invalidateLegacySshGitWorktreeStatus(ws.gitWorktree);
          }
          events.emit(fileChangesChannel, {
            projectId: context.projectId,
            workspaceId,
            update,
          });
          workspaceFileIndexService.onWorkspaceFileChange(workspaceId, update);
        });
        if (fileChanges.success) {
          unsubscribeFileChanges = fileChanges.data.unsubscribe;
          void fileChanges.data.ready().then((result) => {
            if (!result.success) {
              log.warn('WorkspaceFactory: file change feed failed to become ready', {
                workspaceId,
                error: result.error,
              });
            }
          });
        } else {
          log.warn('WorkspaceFactory: failed to start file change feed', {
            workspaceId,
            error: fileChanges.error,
          });
        }

        if (ownsFetchService) {
          gitRepositoryFetchService.start();
        }
        void (async () => {
          if (scripts?.setup && (projectSettings.autoRunSetupScriptOnTaskCreation ?? true)) {
            const setupResult = await runLifecycleScriptWithPolicy({
              workspace: ws,
              projectId: context.projectId,
              taskId: context.task.id,
              workspaceId,
              type: 'setup',
              script: scripts.setup,
              shellSetup,
              origin: 'auto-setup',
              policy: {
                respawnAfterExit: true,
                logFailure: true,
                surfaceFailure: true,
                continueOnFailure: true,
              },
              logPrefix,
            });
            if (setupResult.kind !== 'succeeded') return;
          }

          if (scripts?.run && (projectSettings.autoRunRunScriptOnTaskCreation ?? false)) {
            await runLifecycleScriptWithPolicy({
              workspace: ws,
              projectId: context.projectId,
              taskId: context.task.id,
              workspaceId,
              type: 'run',
              script: scripts.run,
              shellSetup,
              origin: 'auto-run',
              policy: {
                respawnAfterExit: true,
                logFailure: true,
                surfaceFailure: true,
                continueOnFailure: true,
              },
              logPrefix,
            });
          }
        })();
      },

      onCreate: context.extraHooks?.onCreate,

      onDestroy: async (ws) => {
        await previewServerService.stopForWorkspace(context.projectId, workspaceId);
        if (ownsFetchService) {
          gitRepositoryFetchService.stop();
        }
        workspaceFileIndexService.onWorkspaceDeactivated(workspaceId);
        const latestProjectSettings = await context.settings.get();
        const latestTaskSettings = await getEffectiveTaskSettings({
          projectSettings: context.settings,
          taskFs: ws.fileSystem,
          taskConfigPath: ws.configPath,
        });
        const latestShellSetup = latestTaskSettings.shellSetup ?? latestProjectSettings.shellSetup;
        const teardownScript = latestTaskSettings.scripts?.teardown;

        if (teardownScript) {
          await runLifecycleScriptWithPolicy({
            workspace: ws,
            projectId: context.projectId,
            taskId: context.task.id,
            workspaceId,
            type: 'teardown',
            script: teardownScript,
            shellSetup: latestShellSetup,
            origin: 'workspace-destroy',
            policy: {
              timeoutMs: TEARDOWN_SCRIPT_WAIT_MS,
              logFailure: true,
              surfaceFailure: false,
              continueOnFailure: true,
            },
            logPrefix,
          });
        }
        await context.extraHooks?.onDestroy?.(ws);
      },

      onDetach: async (ws) => {
        await previewServerService.stopForWorkspace(context.projectId, workspaceId);
        await context.extraHooks?.onDetach?.(ws);
      },
    };
  };
}

async function acquireWorkspaceRuntime(
  workspaceRuntime: WorkspaceFactoryContext['workspaceRuntime'],
  workDir: string
) {
  const runtimeLease = await workspaceRuntime.manager.acquire(workspaceRuntime.machine);
  try {
    const worktreeLease = await runtimeLease.value.git.openWorktree(workDir);
    try {
      const openedFileTree = await runtimeLease.value.files.openTree(workDir);
      if (!openedFileTree.success) {
        throw new Error(`Failed to open file tree: ${JSON.stringify(openedFileTree.error)}`);
      }
      const fileTreeLease = openedFileTree.data;

      let released = false;
      return {
        gitWorktree: worktreeLease.value,
        fileTree: fileTreeLease.value,
        filesRuntime: runtimeLease.value.files,
        release: async () => {
          if (released) return;
          released = true;
          await fileTreeLease.release();
          await worktreeLease.release();
          await runtimeLease.release();
        },
      };
    } catch (error) {
      await worktreeLease.release();
      throw error;
    }
  } catch (error) {
    await runtimeLease.release();
    throw error;
  }
}

type TaskProviderOpts = {
  projectId: string;
  taskId: string;
  workspaceId: string;
  taskPath: string;
  tmuxEnabled: boolean;
  shellSetup?: string;
  taskEnvVars: Record<string, string>;
  filesRuntime?: IFilesRuntime;
};

async function resolveLocalConversationShellProfile(taskId: string): Promise<ResolvedShellProfile> {
  const { defaultShell } = await appSettingsService.get('terminal');
  return await resolveLocalAutomationShellWithSystemFallback({
    intent: defaultShell,
    onFallback: (error) => {
      log.warn(
        'buildTaskProviders: preferred local conversation shell unavailable, using fallback',
        {
          shell: error.shell,
          taskId,
        }
      );
    },
  });
}

/**
 * Creates task-scoped conversation and terminal providers for the given transport type.
 * The exec function is derived internally from the WorkspaceType.
 */
export async function buildTaskProviders(
  type: WorkspaceType,
  opts: TaskProviderOpts
): Promise<{ conversations: ConversationProvider; terminals: TerminalProvider }> {
  if (type.kind === 'ssh') {
    if (!opts.filesRuntime) {
      throw new Error('Missing SSH files runtime for SSH task provider');
    }
    const ctx = new SshExecutionContext(type.proxy, { connectionId: type.connectionId });
    return {
      conversations: new SshConversationProvider({
        projectId: opts.projectId,
        taskPath: opts.taskPath,
        taskId: opts.taskId,
        tmux: opts.tmuxEnabled,
        shellSetup: opts.shellSetup,
        ctx,
        proxy: type.proxy,
        filesRuntime: opts.filesRuntime,
        taskEnvVars: opts.taskEnvVars,
      }),
      terminals: new SshTerminalProvider({
        projectId: opts.projectId,
        workspaceId: opts.workspaceId,
        scopeId: opts.taskId,
        taskPath: opts.taskPath,
        tmux: opts.tmuxEnabled,
        shellSetup: opts.shellSetup,
        ctx,
        proxy: type.proxy,
        connectionId: type.connectionId,
        taskEnvVars: opts.taskEnvVars,
      }),
    };
  }

  const ctx = new LocalExecutionContext();
  const conversationShellProfile = await resolveLocalConversationShellProfile(opts.taskId);
  return {
    conversations: new LocalConversationProvider({
      projectId: opts.projectId,
      taskPath: opts.taskPath,
      taskId: opts.taskId,
      tmux: opts.tmuxEnabled,
      shellSetup: opts.shellSetup,
      shellProfile: conversationShellProfile,
      ctx,
      taskEnvVars: opts.taskEnvVars,
    }),
    terminals: new LocalTerminalProvider({
      projectId: opts.projectId,
      workspaceId: opts.workspaceId,
      scopeId: opts.taskId,
      taskPath: opts.taskPath,
      tmux: opts.tmuxEnabled,
      shellSetup: opts.shellSetup,
      ctx,
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
  workspace: Pick<Workspace, 'path' | 'fileSystem' | 'configPath'>,
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
    taskFs: workspace.fileSystem,
    taskConfigPath: workspace.configPath,
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
