import { taskSessionManager } from '@main/core/tasks/task-session-manager';
import { workspaceRegistry } from '@main/core/workspaces/workspace-registry';

export type NativeChatTarget = {
  cwd: string;
  taskEnvVars: Record<string, string>;
};

/**
 * Resolve the worktree cwd and task env for a native chat turn. Requires the
 * task to be provisioned and local — native chat never drives remote tasks.
 */
export function resolveNativeChatTarget(taskId: string): NativeChatTarget {
  const task = taskSessionManager.getTask(taskId);
  if (!task) throw new Error('Task is not ready');

  const persistData = taskSessionManager.getPersistData(taskId);
  if (persistData?.sshConnectionId) {
    throw new Error('Native native chat is not supported for remote tasks');
  }

  const workspace = persistData ? workspaceRegistry.get(persistData.workspaceId) : undefined;
  if (!workspace) throw new Error('Workspace not found for task');

  return { cwd: workspace.path, taskEnvVars: task.taskEnvVars };
}
