import { createContext, ReactNode, useCallback, useContext, useState } from 'react';

interface TaskViewState {
  view: 'agents' | 'editor';
}

const DEFAULT_TASK_VIEW_STATE: TaskViewState = {
  view: 'agents',
};

interface TaskViewStateContextValue {
  getTaskViewState: (taskId: string) => TaskViewState;
  setTaskViewState: (taskId: string, update: Partial<TaskViewState>) => void;
  deleteTaskViewState: (taskId: string) => void;
}

const TaskViewStateContext = createContext<TaskViewStateContextValue | null>(null);

export function TaskViewStateProvider({ children }: { children: ReactNode }) {
  const [states, setStates] = useState<Record<string, TaskViewState>>({});

  const getTaskViewState = useCallback(
    (taskId: string) => {
      return states[taskId] ?? DEFAULT_TASK_VIEW_STATE;
    },
    [states]
  );

  const setTaskViewState = useCallback((taskId: string, update: Partial<TaskViewState>) => {
    setStates((prev) => ({
      ...prev,
      [taskId]: { ...prev[taskId], ...update },
    }));
  }, []);

  const deleteTaskViewState = useCallback((taskId: string) => {
    setStates((prev) => {
      const { [taskId]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  return (
    <TaskViewStateContext.Provider
      value={{ getTaskViewState, setTaskViewState, deleteTaskViewState }}
    >
      {children}
    </TaskViewStateContext.Provider>
  );
}

export function useTaskViewState() {
  const ctx = useContext(TaskViewStateContext);
  if (!ctx) {
    throw new Error('useTaskViewState must be used within a TaskViewStateProvider');
  }
  return ctx;
}
