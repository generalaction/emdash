import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { Task } from '@shared/tasks';
import { useTaskViewState } from '@renderer/features/tasks/task-view-state-provider';
import { useTasksContext } from '@renderer/features/tasks/tasks-provider';
import {
  PendingTask,
  usePendingTasksContext,
} from '@renderer/views/projects/pending-tasks-provider';
import { ProjectViewWrapper } from '@renderer/views/projects/project-view-wrapper';

interface TaskViewWrapperProps {
  children: ReactNode;
  projectId: string;
  taskId: string;
}

interface TaskViewContext {
  view: 'agents' | 'editor';
  setView: (view: 'agents' | 'editor') => void;
  activeConversationId?: string;
  setActiveConversationId: (conversationId: string) => void;
}

export type TaskStatus = 'ready' | 'pending';

const TaskViewContext = createContext<TaskViewContext | null>(null);
const CurrentTaskStatusContext = createContext<{ status: TaskStatus } | null>(null);
const CurrentTaskContext = createContext<{ currentTask: Task } | null>(null);
const CurrentPendingTaskContext = createContext<{ currentPendingTask: PendingTask } | null>(null);

function useTask({ projectId, taskId }: { projectId: string; taskId: string }) {
  const { tasksByProjectId } = useTasksContext();
  const { pendingTasksByProjectId } = usePendingTasksContext();

  const status: TaskStatus = useMemo(() => {
    // If the real task already exists in the cache, treat it as ready immediately
    // regardless of whether the pending entry has been cleaned up yet.
    const isReady = (tasksByProjectId[projectId] ?? []).some((t) => t.id === taskId);
    if (isReady) return 'ready';
    return (pendingTasksByProjectId[projectId] ?? []).some((task) => task.id === taskId)
      ? 'pending'
      : 'ready';
  }, [tasksByProjectId, pendingTasksByProjectId, projectId, taskId]);

  const task = useMemo(() => {
    if (status === 'ready') {
      return tasksByProjectId[projectId]?.find((task) => task.id === taskId) ?? null;
    }
    return pendingTasksByProjectId[projectId]?.find((task) => task.id === taskId) ?? null;
  }, [status, tasksByProjectId, pendingTasksByProjectId, projectId, taskId]);

  return { status, task };
}

export function TaskViewWrapper({ children, projectId, taskId }: TaskViewWrapperProps) {
  const { getTaskViewState, setTaskViewState } = useTaskViewState();
  const { status, task } = useTask({ projectId, taskId });

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
      <CurrentTaskStatusContext.Provider value={{ status }}>
        <CurrentTaskContextProvider status={status} task={task ?? undefined}>
          <TaskViewContext.Provider
            value={{
              view,
              setView,
              activeConversationId: agentsView.activeConversationId,
              setActiveConversationId,
            }}
          >
            {children}
          </TaskViewContext.Provider>
        </CurrentTaskContextProvider>
      </CurrentTaskStatusContext.Provider>
    </ProjectViewWrapper>
  );
}

function CurrentTaskContextProvider({
  children,
  status,
  task,
}: {
  children: ReactNode;
  status: TaskStatus;
  task?: Task | PendingTask;
}) {
  if (status === 'ready') {
    return (
      <CurrentTaskContext.Provider value={{ currentTask: task as Task }}>
        {children}
      </CurrentTaskContext.Provider>
    );
  }
  return (
    <CurrentPendingTaskContext.Provider value={{ currentPendingTask: task as PendingTask }}>
      {children}
    </CurrentPendingTaskContext.Provider>
  );
}

export function useCurrentTaskStatus() {
  const ctx = useContext(CurrentTaskStatusContext);
  if (!ctx) {
    throw new Error('useCurrentTaskStatus must be used within a CurrentTaskStatusContextProvider');
  }
  return ctx;
}

export function useCurrentTask() {
  const ctx = useContext(CurrentTaskContext);
  if (!ctx) {
    throw new Error('useCurrentTask must be used within a CurrentTaskContextProvider');
  }
  return ctx;
}

export function useCurrentPendingTask() {
  const ctx = useContext(CurrentPendingTaskContext);
  if (!ctx) {
    throw new Error('useCurrentPendingTask must be used within a CurrentTaskContextProvider');
  }
  return ctx;
}

export function useTaskViewContext() {
  const context = useContext(TaskViewContext);
  if (!context) {
    throw new Error('useTaskViewContext must be used within a TaskViewProvider');
  }
  return context;
}
