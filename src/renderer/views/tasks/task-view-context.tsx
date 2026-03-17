import { createContext, ReactNode, useCallback, useContext } from 'react';
import type { Conversation, CreateConversationParams } from '@shared/conversations';
import type { Task } from '@shared/tasks';
import type { Terminal } from '@shared/terminals';
import { useTaskViewState } from '@renderer/features/tasks/task-view-state-provider';
import { ProjectViewWrapper } from '@renderer/views/projects/project-view-wrapper';
import { useConversations } from './hooks/use-conversations';
import { useTask, type TaskStatus } from './hooks/use-task';
import { useTerminals } from './hooks/use-terminals';

type RightPanelView = 'changes' | 'files' | 'terminals';

interface TaskViewContext {
  view: 'agents' | 'editor';
  setView: (view: 'agents' | 'editor') => void;
  activeConversationId?: string;
  setActiveConversationId: (conversationId: string) => void;
  activeTerminalId?: string;
  setActiveTerminalId: (terminalId: string) => void;
  rightPanelView: RightPanelView;
  setRightPanelView: (view: RightPanelView) => void;
  taskStatus: TaskStatus;
  task?: Task;
  conversations: Conversation[];
  createConversation: (
    params: Omit<CreateConversationParams, 'projectId' | 'taskId'>
  ) => Promise<Conversation>;
  removeConversation: (conversationId: string) => void;
  terminals: Terminal[];
  createTerminal: () => Promise<Terminal>;
  removeTerminal: (terminalId: string) => void;
}

const TaskViewContext = createContext<TaskViewContext | null>(null);

export function TaskViewWrapper({
  children,
  projectId,
  taskId,
}: {
  children: ReactNode;
  projectId: string;
  taskId: string;
}) {
  const { getTaskViewState, setTaskViewState } = useTaskViewState();
  const { taskStatus, task } = useTask({ projectId, taskId });
  const { conversations, createConversation, removeConversation } = useConversations({
    projectId,
    taskId,
  });
  const { terminals, createTerminal, removeTerminal } = useTerminals({ projectId, taskId });

  const { view, agentsView, terminalsView, rightPanelView } = getTaskViewState(taskId);

  const setView = useCallback(
    (v: 'agents' | 'editor') => {
      setTaskViewState(taskId, { view: v });
    },
    [setTaskViewState, taskId]
  );

  const setActiveConversationId = useCallback(
    (conversationId: string) => {
      setTaskViewState(taskId, { agentsView: { activeConversationId: conversationId } });
    },
    [setTaskViewState, taskId]
  );

  const setActiveTerminalId = useCallback(
    (terminalId: string) => {
      setTaskViewState(taskId, { terminalsView: { activeTerminalId: terminalId } });
    },
    [setTaskViewState, taskId]
  );

  const setRightPanelView = useCallback(
    (view: RightPanelView) => {
      setTaskViewState(taskId, { rightPanelView: view });
    },
    [setTaskViewState, taskId]
  );

  return (
    <ProjectViewWrapper projectId={projectId}>
      <TaskViewContext.Provider
        value={{
          view,
          setView,
          taskStatus,
          task: task ?? undefined,
          activeConversationId: agentsView.activeConversationId,
          setActiveConversationId,
          activeTerminalId: terminalsView.activeTerminalId,
          setActiveTerminalId,
          rightPanelView,
          setRightPanelView,
          conversations,
          createConversation,
          removeConversation,
          terminals,
          createTerminal,
          removeTerminal,
        }}
      >
        {children}
      </TaskViewContext.Provider>
    </ProjectViewWrapper>
  );
}

export function useTaskViewContext() {
  const context = useContext(TaskViewContext);
  if (!context) {
    throw new Error('useTaskViewContext must be used within a TaskViewContextProvider');
  }
  return context;
}

export function useReadyTaskViewContext(): TaskViewContext & { task: Task } {
  const context = useTaskViewContext();
  if (!context.task) {
    throw new Error('useReadyTaskViewContext must be used within a ready task');
  }
  return { ...context, task: context.task as Task };
}
