import { useQuery } from '@tanstack/react-query';
import React, { createContext, useContext, useMemo } from 'react';
import { Task } from '@shared/tasks';
import { rpc } from '@renderer/lib/ipc';

interface TasksContextValue {
  tasks: Task[];
  tasksByProjectId: Record<string, Task[]>;
}

export const TasksContext = createContext<TasksContextValue | null>(null);

export function useTasksContext(): TasksContextValue {
  const ctx = useContext(TasksContext);
  if (!ctx) {
    throw new Error('useTasksContext must be used within a TasksContext.Provider');
  }
  return ctx;
}

export function TasksProvider({ children }: { children: React.ReactNode }) {
  const { data: tasks } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => rpc.tasks.getTasks(),
    staleTime: Infinity,
  });

  const tasksByProjectId = useMemo(() => {
    return (tasks ?? []).reduce(
      (acc, task) => {
        acc[task.projectId] = [...(acc[task.projectId] || []), task];
        return acc;
      },
      {} as Record<string, Task[]>
    );
  }, [tasks]);

  return (
    <TasksContext.Provider value={{ tasks: tasks ?? [], tasksByProjectId }}>
      {children}
    </TasksContext.Provider>
  );
}
