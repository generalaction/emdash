import type { ConversationManagerStore } from '@core/features/conversations/browser/conversation-manager';
import { getConversationsForTask } from '@core/features/conversations/browser/conversation-selectors';
import type { PreviewServerStore } from '@core/features/tasks/browser/stores/preview-server-store';
import { getTaskStore } from '@core/features/tasks/browser/stores/task-selectors';
import { useTaskViewContext } from '@core/features/tasks/browser/task-view-context';
import type { TerminalManagerStore } from '@core/features/terminals/browser/task-terminal/terminal-manager';
import { getTerminalsForTask } from '@core/features/terminals/browser/terminal-selectors';
import type { WorkspaceStore } from '@core/features/workspaces/browser/stores/workspace';
import type { TaskComposition } from './task-composition';
import { getTaskComposition, getTaskWorkspace } from './task-composition-selectors';

export function useTaskComposition(): TaskComposition {
  const { projectId, taskId } = useTaskViewContext();
  const composition = getTaskComposition(projectId, taskId);
  if (!composition) throw new Error('useTaskComposition: task is not registered');
  return composition;
}

export function useWorkspace(): WorkspaceStore {
  const { projectId, taskId } = useTaskViewContext();
  const workspace = getTaskWorkspace(projectId, taskId);
  if (!workspace) throw new Error('useWorkspace: task is not provisioned');
  return workspace;
}

export function useWorkspaceId(): string {
  const { projectId, taskId } = useTaskViewContext();
  const workspaceId = getTaskStore(projectId, taskId)?.workspaceId;
  if (!workspaceId) throw new Error('useWorkspaceId: task has no workspace');
  return workspaceId;
}

export function usePreviewServers(): PreviewServerStore {
  const previewServers = useTaskComposition().previewServers;
  if (!previewServers) throw new Error('usePreviewServers: task is not provisioned');
  return previewServers;
}

export function useConversations(): ConversationManagerStore {
  const { taskId } = useTaskViewContext();
  const manager = getConversationsForTask(taskId);
  if (!manager) throw new Error('useConversations: task is not registered');
  return manager;
}

export function useTerminals(): TerminalManagerStore {
  const { taskId } = useTaskViewContext();
  const manager = getTerminalsForTask(taskId);
  if (!manager) throw new Error('useTerminals: task is not registered');
  return manager;
}
