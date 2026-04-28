import type { Conversation } from '@shared/conversations';
import type { Task } from '@shared/tasks';
import type { Terminal } from '@shared/terminals';
import type { ConversationProvider } from '@main/core/conversations/types';
import type { TerminalProvider } from '@main/core/terminals/terminal-provider';
import type { Workspace } from '@main/core/workspaces/workspace';
import { log } from '@main/lib/logger';
import type { TaskProvider } from './project-provider';
import type { ProjectSettingsProvider } from './settings/schema';
import { buildTaskProviders, resolveTaskEnv, type WorkspaceType } from './workspace-factory';

export type BuildTaskResult = {
  taskProvider: TaskProvider;
  conversationProvider: ConversationProvider;
  terminalProvider: TerminalProvider;
};

/**
 * Shared tail of doProvisionTask — builds and hydrates a TaskProvider from
 * an already-acquired workspace. Works for both local and SSH transports.
 *
 * Returns all three provider objects so callers (e.g. SshProjectProvider)
 * can keep references for reconnect rehydration.
 */
export async function buildTaskFromWorkspace(
  task: Task,
  workspace: Workspace,
  type: WorkspaceType,
  projectId: string,
  projectPath: string,
  settings: ProjectSettingsProvider,
  hydrate: { conversations: Conversation[]; terminals: Terminal[] },
  logPrefix: string
): Promise<BuildTaskResult> {
  const { taskEnvVars, tmuxEnabled, shellSetup } = await resolveTaskEnv(
    task,
    workspace,
    projectPath,
    settings
  );

  const { conversations: conversationProvider, terminals: terminalProvider } = buildTaskProviders(
    type,
    {
      projectId,
      taskId: task.id,
      taskPath: workspace.path,
      tmuxEnabled,
      shellSetup,
      taskEnvVars,
    }
  );

  const taskProvider: TaskProvider = {
    taskId: task.id,
    workspaceId: workspace.id,
    taskBranch: task.taskBranch,
    sourceBranch: task.sourceBranch,
    taskEnvVars,
    conversations: conversationProvider,
    terminals: terminalProvider,
  };

  void Promise.all(
    hydrate.terminals.map((term) =>
      terminalProvider.spawnTerminal(term).catch((e) => {
        log.error(`${logPrefix}: failed to hydrate terminal`, {
          terminalId: term.id,
          error: String(e),
        });
      })
    )
  );

  void Promise.all(
    hydrate.conversations.map((conv) =>
      conversationProvider.startSession(conv, undefined, true).catch((e) => {
        log.error(`${logPrefix}: failed to hydrate conversation`, {
          conversationId: conv.id,
          error: String(e),
        });
      })
    )
  );

  return { taskProvider, conversationProvider, terminalProvider };
}
