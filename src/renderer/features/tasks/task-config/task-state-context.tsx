import { createContext, useContext } from 'react';
import type { InitialConversationState } from '@renderer/features/tasks/conversations/initial-conversation-section';
import type { WorkspaceConfigState } from '@renderer/features/tasks/create-task-modal/use-workspace-config';
import type { LinkedIssue } from '@shared/core/linked-issue';

export type TaskStateContextValue = {
  workspaceConfig: WorkspaceConfigState;
  initialConversation: InitialConversationState;
  projectId?: string;
  isUnborn: boolean;
  hasPR: boolean;
  isWorkspaceProviderEnabled: boolean;
  linkedIssue?: LinkedIssue;
  includeIssueContextByDefault: boolean;
};

const TaskStateContext = createContext<TaskStateContextValue | null>(null);

export function TaskStateProvider({
  children,
  ...value
}: TaskStateContextValue & { children: React.ReactNode }) {
  return <TaskStateContext.Provider value={value}>{children}</TaskStateContext.Provider>;
}

export function useTaskState(): TaskStateContextValue {
  const ctx = useContext(TaskStateContext);
  if (!ctx) {
    throw new Error('useTaskState must be used inside a TaskStateProvider');
  }
  return ctx;
}
