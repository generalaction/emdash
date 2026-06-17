import type { GitStatusModel } from '@emdash/shared/git';
import { eq } from 'drizzle-orm';
import { LocalConversationProvider } from '@main/core/conversations/impl/local-conversation';
import { SshConversationProvider } from '@main/core/conversations/impl/ssh-conversation';
import type { ConversationProvider } from '@main/core/conversations/types';
import { detectMultiplexers } from '@main/core/dependencies/core-deps/detect-multiplexers';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { SshExecutionContext } from '@main/core/execution-context/ssh-execution-context';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import { GitRepositoryFetchService } from '@main/core/git/repository/fetch-service';
import { GitRepositoryService } from '@main/core/git/repository/service';
import type { MultiplexerBackend, MultiplexerId } from '@main/core/pty/multiplexer';
import { selectMultiplexer } from '@main/core/pty/multiplexer';
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
import { db } from '@main/db/client';
import { workspaces as workspacesTable } from '@main/db/schema';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { gitWorktreeUpdateChannel } from '@shared/core/git/events';
import type { Task } from '@shared/core/tasks/tasks';
import { getEffectiveTaskSettings } from '../projects/settings/effective-task-settings';
import type { ProjectSettingsProvider } from '../projects/settings/provider';
import { TEARDOWN_SCRIPT_WAIT_MS } from '../tasks/provision-task-error';
import { getTaskEnvVars } from './workspace-env';

export async function resolveMultiplexers(
  persistenceOn: boolean,
  connectionId: string | undefined
): Promise<{
  agentMultiplexer: MultiplexerBackend | null;
  terminalMultiplexer: MultiplexerBackend | null;
}> {
  if (!persistenceOn) {
    return { agentMultiplexer: null, terminalMultiplexer: null };
  }
  const detected = await detectMultiplexers(connectionId);
  const overrideEnv = process.env.EMDASH_AGENT_MULTIPLEXER;
  const override: MultiplexerId | undefined =
    overrideEnv === 'tmux' || overrideEnv === 'boo' ? overrideEnv : undefined;
  return {
    agentMultiplexer: selectMultiplexer('agent', detected, override),
    terminalMultiplexer: selectMultiplexer('terminal', detected),
  };
}

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

    // Transport-specific FS and exec
    const workspaceFs =
      type.kind === 'ssh' ? new SshFileSystem(type.proxy, workDir) : new LocalFileSystem(workDir);

    const ctx =
      type.kind === 'ssh' ? new SshExecutionContext(type.proxy) : new LocalExecutionContext();

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
    const persistenceOn = projectSettings.tmux ?? false;
    const connectionId = type.kind === 'ssh' ? type.connectionId : undefined;
    const { terminalMultiplexer } = await resolveMultiplexers(persistenceOn, connectionId);
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
            multiplexer: terminalMultiplexer,
            shellSetup,
            ctx,
            proxy: type.proxy,
            connectionId: type.connectionId,
            taskEnvVars: bootstrapTaskEnvVars,
          })
        : new LocalTerminalProvider({
            projectId: context.projectId,
            scopeId: workspaceId,
            taskPath: workDir,
            multiplexer: terminalMultiplexer,
            shellSetup,
            ctx,
            taskEnvVars: bootstrapTaskEnvVars,
          });

    const lifecycleService = new LifecycleScriptService({
      projectId: context.projectId,
      workspaceId,
      terminals: workspaceTerminals,
    });

    const runtimeLease = await context.workspaceRuntime.manager.acquire(
      context.workspaceRuntime.machine
    );
    const worktreeLease = await runtimeLease.value.git.openWorktree(workDir);
    const gitWorktree = worktreeLease.value;

    const gitRepository =
      context.gitRepository ?? new GitRepositoryService(gitWorktree.repository, context.settings);

    const ownsFetchService = !context.gitRepositoryFetchService;
    const gitRepositoryFetchService =
      context.gitRepositoryFetchService ??
      new GitRepositoryFetchService(gitRepository, () => gitRepository.getBaseRemote());
    let unsubscribeGitUpdates: (() => void) | undefined;

    const workspace: Workspace = {
      id: workspaceId,
      path: workDir,
      fs: workspaceFs,
      gitWorktree,
      settings: context.settings,
      lifecycleService,
      gitRepository,
      gitRepositoryFetchService,
      dispose: () => {
        unsubscribeGitUpdates?.();
        unsubscribeGitUpdates = undefined;
        worktreeLease.release();
        runtimeLease.release();
      },
    };

    const { logPrefix } = context;

    return {
      workspace,

      onCreateSideEffect: (ws) => {
        unsubscribeGitUpdates = ws.gitWorktree.subscribe((update) => {
          events.emit(gitWorktreeUpdateChannel, {
            projectId: context.projectId,
            workspaceId,
            update,
          });
          if (update.kind === 'status' && update.model.kind === 'ok') {
            void cacheWorkspaceLineStats(workspaceId, update.model);
          }
        });

        if (ownsFetchService) {
          gitRepositoryFetchService.start();
        }
        void workspaceFileIndexService.onWorkspaceCreated(workspaceId, ws);
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
        if (ownsFetchService) {
          gitRepositoryFetchService.stop();
        }
        workspaceFileIndexService.onWorkspaceDestroyed(workspaceId);
        const latestTaskSettings = await getEffectiveTaskSettings({
          projectSettings: context.settings,
          taskFs: ws.fs,
        });
        const latestProjectSettings = await context.settings.get();
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
        await context.extraHooks?.onDetach?.(ws);
      },
    };
  };
}

async function cacheWorkspaceLineStats(
  workspaceId: string,
  status: Extract<GitStatusModel, { kind: 'ok' }>
): Promise<void> {
  let unstagedAdded = 0;
  let unstagedDeleted = 0;
  for (const c of status.unstaged) {
    unstagedAdded += c.additions;
    unstagedDeleted += c.deletions;
  }
  try {
    await db
      .update(workspacesTable)
      .set({
        linesAdded: status.stagedAdded + unstagedAdded,
        linesDeleted: status.stagedDeleted + unstagedDeleted,
      })
      .where(eq(workspacesTable.id, workspaceId));
  } catch (e) {
    log.warn('Failed to cache workspace git status', { workspaceId, error: String(e) });
  }
}

type TaskProviderOpts = {
  projectId: string;
  taskId: string;
  taskPath: string;
  agentMultiplexer: MultiplexerBackend | null;
  terminalMultiplexer: MultiplexerBackend | null;
  shellSetup?: string;
  taskEnvVars: Record<string, string>;
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
    const ctx = new SshExecutionContext(type.proxy);
    return {
      conversations: new SshConversationProvider({
        projectId: opts.projectId,
        taskPath: opts.taskPath,
        taskId: opts.taskId,
        multiplexer: opts.agentMultiplexer,
        shellSetup: opts.shellSetup,
        ctx,
        proxy: type.proxy,
        taskEnvVars: opts.taskEnvVars,
      }),
      terminals: new SshTerminalProvider({
        projectId: opts.projectId,
        scopeId: opts.taskId,
        taskPath: opts.taskPath,
        multiplexer: opts.terminalMultiplexer,
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
      multiplexer: opts.agentMultiplexer,
      shellSetup: opts.shellSetup,
      shellProfile: conversationShellProfile,
      ctx,
      taskEnvVars: opts.taskEnvVars,
    }),
    terminals: new LocalTerminalProvider({
      projectId: opts.projectId,
      scopeId: opts.taskId,
      taskPath: opts.taskPath,
      multiplexer: opts.terminalMultiplexer,
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
  workspace: Pick<Workspace, 'path' | 'fs'>,
  projectPath: string,
  settings: ProjectSettingsProvider,
  type: WorkspaceType
): Promise<{
  taskEnvVars: Record<string, string>;
  agentMultiplexer: MultiplexerBackend | null;
  terminalMultiplexer: MultiplexerBackend | null;
  shellSetup?: string;
}> {
  const projectSettings = await settings.get();
  const defaultBranch = await settings.getDefaultBranch();
  const taskLevelSettings = await getEffectiveTaskSettings({
    projectSettings: settings,
    taskFs: workspace.fs,
  });
  const persistenceOn = projectSettings.tmux ?? false;
  const connectionId = type.kind === 'ssh' ? type.connectionId : undefined;
  const { agentMultiplexer, terminalMultiplexer } = await resolveMultiplexers(
    persistenceOn,
    connectionId
  );
  return {
    taskEnvVars: getTaskEnvVars({
      taskId: task.id,
      taskName: task.name,
      taskPath: workspace.path,
      projectPath,
      defaultBranch,
      portSeed: workspace.path,
    }),
    agentMultiplexer,
    terminalMultiplexer,
    shellSetup: taskLevelSettings.shellSetup ?? projectSettings.shellSetup,
  };
}
