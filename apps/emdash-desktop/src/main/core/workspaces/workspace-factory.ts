import path from 'node:path';
import { TuiConversationProvider } from '@main/core/conversations/tui-conversation-provider';
import type { ConversationProvider } from '@main/core/conversations/types';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { registerFileSearchRoot } from '@main/core/file-search/runtime-client';
import { filesClientScope } from '@main/core/files/runtime-client';
import { previewServerService } from '@main/core/preview-servers/preview-server-service-instance';
import type { SshClientProxy } from '@main/core/ssh/lifecycle/ssh-client-proxy';
import { LocalTerminalProvider } from '@main/core/terminals/impl/local-terminal-provider';
import type { TerminalProvider } from '@main/core/terminals/terminal-provider';
import { getFilesRuntimeClient } from '@main/core/wire-workers/accessors';
import type { Workspace } from '@main/core/workspaces/workspace';
import { LifecycleScriptService } from '@main/core/workspaces/workspace-lifecycle-service';
import type { WorkspaceFactoryResult } from '@main/core/workspaces/workspace-registry';
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
        void registerFileSearchRoot(created.files.root);
      },
      onCreate: context.extraHooks?.onCreate,
      onDestroy: async (destroyed) => {
        await previewServerService.stopForWorkspace(context.projectId, workspaceId);
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
  return {
    conversations: new TuiConversationProvider({
      projectId: opts.projectId,
      taskPath: opts.taskPath,
      taskId: opts.taskId,
      tmux: opts.tmuxEnabled,
      shellSetup: opts.shellSetup,
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
