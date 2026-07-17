import { createContext, useContext } from 'react';
import type { WorkspaceConfigState } from '@core/features/tasks/browser/create-task-modal/use-workspace-config';
import type { InitialConversationState } from '@core/features/tasks/browser/task-config/initial-conversation-section';
import type { LinkedIssue } from '@core/primitives/linked-issues/api';

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
