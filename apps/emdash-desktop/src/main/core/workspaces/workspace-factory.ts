import path from 'node:path';
import { LocalConversationProvider } from '@main/core/conversations/impl/local-conversation';
import type { ConversationProvider } from '@main/core/conversations/types';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { RuntimeFileSystem } from '@main/core/files/runtime-files';
import { GitRepositoryFetchService } from '@main/core/git/repository/fetch-service';
import { GitRepositoryService } from '@main/core/git/repository/service';
import { RuntimeGit } from '@main/core/git/runtime-git';
import { previewServerService } from '@main/core/preview-servers/preview-server-service-instance';
import { workspaceFileIndexService } from '@main/core/search/workspace-file-index-service';
import { appSettingsService } from '@main/core/settings/settings-service';
import type { SshClientProxy } from '@main/core/ssh/lifecycle/ssh-client-proxy';
import { resolveLocalAutomationShellWithSystemFallback } from '@main/core/terminal-shell/resolver';
import type { ResolvedShellProfile } from '@main/core/terminal-shell/types';
import { LocalTerminalProvider } from '@main/core/terminals/impl/local-terminal-provider';
import { runLifecycleScriptWithPolicy } from '@main/core/terminals/lifecycle-script-coordinator';
import type { TerminalProvider } from '@main/core/terminals/terminal-provider';
import type { Workspace } from '@main/core/workspaces/workspace';
import { LifecycleScriptService } from '@main/core/workspaces/workspace-lifecycle-service';
import type { WorkspaceFactoryResult } from '@main/core/workspaces/workspace-registry';
import { log } from '@main/lib/logger';
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
  settings: ProjectSettingsProvider;
  logPrefix: string;
  gitRepository?: GitRepositoryService;
  gitRepositoryFetchService?: GitRepositoryFetchService;
  extraHooks?: {
    onCreate?: (workspace: Workspace) => Promise<void>;
    onDestroy?: (workspace: Workspace) => Promise<void>;
    onDetach?: (workspace: Workspace) => Promise<void>;
  };
};

const git = new RuntimeGit();

export function createWorkspaceFactory(
  workspaceId: string,
  type: WorkspaceType,
  context: WorkspaceFactoryContext
): () => Promise<WorkspaceFactoryResult> {
  return async () => {
    if (type.kind === 'ssh') {
      throw new Error(
        'Remote workspaces require the workspace server and are not supported by this build'
      );
    }

    const workDir = context.workDir;
    const fileSystem = new RuntimeFileSystem(workDir);
    const gitCheckout = git.checkout(workDir);
    const configPath = path.join(workDir, '.emdash.json');
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
    const taskLevelSettings = await getEffectiveTaskSettings({
      projectSettings: context.settings,
      taskFs: fileSystem,
      taskConfigPath: configPath,
    });
    const shellSetup = taskLevelSettings.shellSetup ?? projectSettings.shellSetup;
    const scripts = taskLevelSettings.scripts;
    const ctx = new LocalExecutionContext();
    const workspaceTerminals = new LocalTerminalProvider({
      projectId: context.projectId,
      workspaceId,
      scopeId: workspaceId,
      taskPath: workDir,
      tmux: projectSettings.tmux ?? false,
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
      context.gitRepository ?? new GitRepositoryService(gitCheckout.repository, context.settings);
    const ownsFetchService = !context.gitRepositoryFetchService;
    const gitRepositoryFetchService =
      context.gitRepositoryFetchService ??
      new GitRepositoryFetchService(gitRepository, () => gitRepository.getBaseRemote());

    const workspace: Workspace = {
      id: workspaceId,
      path: workDir,
      configPath,
      fileSystem,
      gitCheckout,
      settings: context.settings,
      lifecycleService,
      gitRepository,
      gitRepositoryFetchService,
    };

    return {
      workspace,
      onCreateSideEffect: (created) => {
        void workspaceFileIndexService.onWorkspaceActivated(workspaceId, {
          rootPath: created.path,
          enumerate: (root, options) => created.fileSystem.enumerate(root, options),
        });
        if (ownsFetchService) gitRepositoryFetchService.start();
        void runAutomaticScripts({
          workspace: created,
          context,
          scripts,
          projectSettings,
          shellSetup,
        });
      },
      onCreate: context.extraHooks?.onCreate,
      onDestroy: async (destroyed) => {
        await previewServerService.stopForWorkspace(context.projectId, workspaceId);
        if (ownsFetchService) gitRepositoryFetchService.stop();
        workspaceFileIndexService.onWorkspaceDeactivated(workspaceId);
        const latestProjectSettings = await context.settings.get();
        const latestTaskSettings = await getEffectiveTaskSettings({
          projectSettings: context.settings,
          taskFs: destroyed.fileSystem,
          taskConfigPath: destroyed.configPath,
        });
        const teardownScript = latestTaskSettings.scripts?.teardown;
        if (teardownScript) {
          await runLifecycleScriptWithPolicy({
            workspace: destroyed,
            projectId: context.projectId,
            taskId: context.task.id,
            workspaceId,
            type: 'teardown',
            script: teardownScript,
            shellSetup: latestTaskSettings.shellSetup ?? latestProjectSettings.shellSetup,
            origin: 'workspace-destroy',
            policy: {
              timeoutMs: TEARDOWN_SCRIPT_WAIT_MS,
              logFailure: true,
              surfaceFailure: false,
              continueOnFailure: true,
            },
            logPrefix: context.logPrefix,
          });
        }
        await context.extraHooks?.onDestroy?.(destroyed);
      },
      onDetach: async (detached) => {
        await previewServerService.stopForWorkspace(context.projectId, workspaceId);
        await context.extraHooks?.onDetach?.(detached);
      },
    };
  };
}

async function runAutomaticScripts(args: {
  workspace: Workspace;
  context: WorkspaceFactoryContext;
  scripts: { setup?: string; run?: string } | undefined;
  projectSettings: Awaited<ReturnType<ProjectSettingsProvider['get']>>;
  shellSetup: string | undefined;
}): Promise<void> {
  const { workspace, context, scripts, projectSettings, shellSetup } = args;
  if (scripts?.setup && (projectSettings.autoRunSetupScriptOnTaskCreation ?? true)) {
    const setup = await runLifecycleScriptWithPolicy({
      workspace,
      projectId: context.projectId,
      taskId: context.task.id,
      workspaceId: workspace.id,
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
      logPrefix: context.logPrefix,
    });
    if (setup.kind !== 'succeeded') return;
  }
  if (scripts?.run && (projectSettings.autoRunRunScriptOnTaskCreation ?? false)) {
    await runLifecycleScriptWithPolicy({
      workspace,
      projectId: context.projectId,
      taskId: context.task.id,
      workspaceId: workspace.id,
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
      logPrefix: context.logPrefix,
    });
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
};

async function resolveLocalConversationShellProfile(taskId: string): Promise<ResolvedShellProfile> {
  const { defaultShell } = await appSettingsService.get('terminal');
  return resolveLocalAutomationShellWithSystemFallback({
    intent: defaultShell,
    onFallback: (error) => {
      log.warn('Preferred local conversation shell unavailable; using fallback', {
        shell: error.shell,
        taskId,
      });
    },
  });
}

export async function buildTaskProviders(
  type: WorkspaceType,
  opts: TaskProviderOpts
): Promise<{ conversations: ConversationProvider; terminals: TerminalProvider }> {
  if (type.kind === 'ssh') {
    throw new Error(
      'Remote workspaces require the workspace server and are not supported by this build'
    );
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
