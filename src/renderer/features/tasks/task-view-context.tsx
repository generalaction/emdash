import { observer } from 'mobx-react-lite';
import { createContext, useContext, type ReactNode } from 'react';
import { ProjectViewWrapper } from '@renderer/features/projects/components/project-view-wrapper';
import type { ConversationManagerStore } from '@renderer/features/tasks/conversations/conversation-manager';
import type { DevServerStore } from '@renderer/features/tasks/stores/dev-server-store';
import {
  getConversationsForTask,
  getRegisteredTaskData,
  getTaskStore,
  getTerminalsForTask,
  getWorkspaceForTask,
  taskViewKind,
  type TaskViewKind,
} from '@renderer/features/tasks/stores/task-selectors';
import type { WorkspaceStore } from '@renderer/features/tasks/stores/workspace';
import type { WorkspaceViewModel } from '@renderer/features/tasks/stores/workspace-view-model';
import type { TerminalManagerStore } from '@renderer/features/tasks/terminals/terminal-manager';

interface TaskViewContext {
  projectId: string;
  taskId: string;
  /** The workspace ID for this task, or null when not yet registered. */
  workspaceId: string | null;
}

const TaskViewContext = createContext<TaskViewContext | null>(null);

export const TaskViewWrapper = observer(function TaskViewWrapper({
  children,
  projectId,
  taskId,
}: {
  children: ReactNode;
  projectId: string;
  taskId: string;
}) {
  const workspaceId = getRegisteredTaskData(projectId, taskId)?.workspaceId ?? null;
  return (
    <ProjectViewWrapper projectId={projectId}>
      <TaskViewContext.Provider value={{ projectId, taskId, workspaceId }}>
        {children}
      </TaskViewContext.Provider>
    </ProjectViewWrapper>
  );
});

export function useTaskViewContext(): TaskViewContext {
  const context = useContext(TaskViewContext);
  if (!context) {
    throw new Error('useTaskViewContext must be used within a TaskViewContextProvider');
  }
  return context;
}

export function useTaskViewKind(): TaskViewKind {
  const { projectId, taskId } = useTaskViewContext();
  return taskViewKind(getTaskStore(projectId, taskId), projectId);
}

// ---------------------------------------------------------------------------
// Focused hooks (Phase 4)
// ---------------------------------------------------------------------------

/** Returns the active WorkspaceStore. Throws if the task is not provisioned. */
export function useWorkspace(): WorkspaceStore {
  const { projectId, taskId } = useTaskViewContext();
  const workspace = getWorkspaceForTask(projectId, taskId);
  if (!workspace) {
    throw new Error('useWorkspace: task is not provisioned (no workspace)');
  }
  return workspace;
}

/** Returns the workspace ID. Throws if the task has no workspace yet. */
export function useWorkspaceId(): string {
  const { workspaceId } = useTaskViewContext();
  if (!workspaceId) throw new Error('useWorkspaceId: task has no workspace');
  return workspaceId;
}

/** Returns the DevServerStore. Throws if the task is not provisioned. */
export function useDevServers(): DevServerStore {
  const { projectId, taskId } = useTaskViewContext();
  const attachment = getTaskStore(projectId, taskId)?.attachment;
  if (!attachment) throw new Error('useDevServers: task is not provisioned');
  return attachment.devServers;
}

/** Returns the WorkspaceViewModel. Throws if the task is not registered. */
export function useWorkspaceViewModel(): WorkspaceViewModel {
  const { projectId, taskId } = useTaskViewContext();
  const viewModel = getTaskStore(projectId, taskId)?.viewModel;
  if (!viewModel) {
    throw new Error('useWorkspaceViewModel: task is not registered (no view model)');
  }
  return viewModel;
}

/** Returns the ConversationManagerStore for the task. Throws if not registered. */
export function useConversations(): ConversationManagerStore {
  const { taskId } = useTaskViewContext();
  const mgr = getConversationsForTask(taskId);
  if (!mgr) {
    throw new Error('useConversations: task is not registered (no conversation manager)');
  }
  return mgr;
}

/** Returns the TerminalManagerStore for the task. Throws if not registered. */
export function useTerminals(): TerminalManagerStore {
  const { taskId } = useTaskViewContext();
  const mgr = getTerminalsForTask(taskId);
  if (!mgr) {
    throw new Error('useTerminals: task is not registered (no terminal manager)');
  }
  return mgr;
}
