import type { ConversationProvider } from '@main/core/conversations/types';
import type { TerminalProvider } from '@main/core/terminals/terminal-provider';
import type { Workspace } from '@main/core/workspaces/workspace';
import { events } from '@main/lib/events';
import type { Branch } from '@shared/core/git/git';
import { taskProvisionProgressChannel, type ProvisionStep } from '@shared/core/tasks/taskEvents';
import type { Task } from '@shared/core/tasks/tasks';
import type { TaskProvider } from '../projects/project-provider';
import type { ProjectSettingsProvider } from '../projects/settings/provider';
import {
  buildTaskProviders,
  resolveTaskEnv,
  type WorkspaceType,
} from '../workspaces/workspace-factory';
import { taskProvisionEvents } from './task-provision-events';

export function emitTaskProvisionProgress(data: {
  taskId: string;
  projectId: string;
  step: ProvisionStep;
  message: string;
}): void {
  events.emit(taskProvisionProgressChannel, data);
  taskProvisionEvents.emitProgress(data);
}

export type BuildTaskResult = {
  taskProvider: TaskProvider;
  conversationProvider: ConversationProvider;
  terminalProvider: TerminalProvider;
};

/**
 * Shared tail of the provision flow — builds a TaskProvider from an already-acquired
 * workspace. Works for both local and SSH transports.
 *
 * Returns all three provider objects so callers (e.g. SshProjectProvider)
 * can keep references for reconnect rehydration.
 *
 * `workspaceBranchName` and `workspaceSourceBranch` are sourced from the
 * workspace row (not the task row), and flow through to `TaskProvider` for
 * PTY env var population.
 */
export async function buildTaskFromWorkspace(
  task: Task,
  workspace: Workspace,
  type: WorkspaceType,
  projectId: string,
  projectPath: string,
  settings: ProjectSettingsProvider,
  workspaceBranchName?: string,
  workspaceSourceBranch?: Branch
): Promise<BuildTaskResult> {
  const { taskEnvVars, tmuxEnabled, shellSetup } = await resolveTaskEnv(
    task,
    workspace,
    projectPath,
    settings
  );

  const { conversations: conversationProvider, terminals: terminalProvider } =
    await buildTaskProviders(type, {
      projectId,
      taskId: task.id,
      taskPath: workspace.path,
      tmuxEnabled,
      shellSetup,
      taskEnvVars,
    });

  const taskProvider: TaskProvider = {
    taskId: task.id,
    taskBranch: workspaceBranchName,
    sourceBranch: workspaceSourceBranch,
    taskEnvVars,
    conversations: conversationProvider,
    terminals: terminalProvider,
  };

  return { taskProvider, conversationProvider, terminalProvider };
}
