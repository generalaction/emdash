import path from 'node:path';
import { LocalConversationProvider } from '@main/core/conversations/impl/local-conversation';
import type { ConversationProvider } from '@main/core/conversations/types';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { filesClientScope } from '@main/core/files/runtime-process/client';
import { getFilesRuntimeClient } from '@main/core/files/runtime-process/host';
import { previewServerService } from '@main/core/preview-servers/preview-server-service-instance';
import { workspaceFileIndexService } from '@main/core/search/workspace-file-index-service';
import { appSettingsService } from '@main/core/settings/settings-service';
import type { SshClientProxy } from '@main/core/ssh/lifecycle/ssh-client-proxy';
import { resolveLocalAutomationShellWithSystemFallback } from '@main/core/terminal-shell/resolver';
import type { ResolvedShellProfile } from '@main/core/terminal-shell/types';
import { LocalTerminalProvider } from '@main/core/terminals/impl/local-terminal-provider';
import type { TerminalProvider } from '@main/core/terminals/terminal-provider';
import type { Workspace } from '@main/core/workspaces/workspace';
import { LifecycleScriptService } from '@main/core/workspaces/workspace-lifecycle-service';
import type { WorkspaceFactoryResult } from '@main/core/workspaces/workspace-registry';
import { log } from '@main/lib/logger';
import type { Task } from '@shared/core/tasks/tasks';
import { getEffectiveTaskSettings } from '../projects/settings/effective-task-settings';
import type { ProjectSettingsProvider } from '../projects/settings/provider';
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
  extraHooks?: {
    onCreate?: (workspace: Workspace) => Promise<void>;
    onDestroy?: (workspace: Workspace) => Promise<void>;
    onDetach?: (workspace: Workspace) => Promise<void>;
  };
};

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
    const filesClient = await getFilesRuntimeClient();
    const files = filesClientScope(filesClient, workDir);
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
      taskFiles: files,
      taskConfigPath: configPath,
    });
    const shellSetup = taskLevelSettings.shellSetup ?? projectSettings.shellSetup;
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
    const workspace: Workspace = {
      id: workspaceId,
      path: workDir,
      configPath,
      files,
      settings: context.settings,
      lifecycleService,
    };

    return {
      workspace,
      onCreateSideEffect: (created) => {
        void workspaceFileIndexService.onWorkspaceActivated(workspaceId, {
          files: created.files,
        });
      },
      onCreate: context.extraHooks?.onCreate,
      onDestroy: async (destroyed) => {
        await previewServerService.stopForWorkspace(context.projectId, workspaceId);
        workspaceFileIndexService.onWorkspaceDeactivated(workspaceId);
        await context.extraHooks?.onDestroy?.(destroyed);
      },
      onDetach: async (detached) => {
        await previewServerService.stopForWorkspace(context.projectId, workspaceId);
        await context.extraHooks?.onDetach?.(detached);
      },
    };
  };
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
  workspace: Pick<Workspace, 'path' | 'files' | 'configPath'>,
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
    taskFiles: workspace.files,
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
