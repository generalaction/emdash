import { createContext, ReactNode, useCallback, useContext } from 'react';
import { Conversation, CreateConversationParams } from '@shared/conversations';
import { Task } from '@shared/tasks';
import { useTaskViewState } from '@renderer/features/tasks/task-view-state-provider';
import { ProjectViewWrapper } from '@renderer/views/projects/project-view-wrapper';
import { useConversations } from './hooks/use-conversations';
import { TaskStatus, useTask } from './hooks/use-task';

interface TaskViewContext {
  view: 'agents' | 'editor';
  setView: (view: 'agents' | 'editor') => void;
  activeConversationId?: string;
  setActiveConversationId: (conversationId: string) => void;
  taskStatus: TaskStatus;
  task?: Task;
  conversations: Conversation[];
  createConversation: (
    params: Omit<CreateConversationParams, 'projectId' | 'taskId'>
  ) => Promise<Conversation>;
  removeConversation: (conversationId: string) => void;
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

  const { view, agentsView } = getTaskViewState(taskId);

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
          conversations,
          createConversation,
          removeConversation,
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
