import { useQuery } from '@tanstack/react-query';
import React, { createContext, useContext, useMemo } from 'react';
import type { Task } from '@shared/tasks';
import { rpc } from '@renderer/core/ipc';

interface TasksDataContextValue {
  tasks: Task[];
  tasksByProjectId: Record<string, Task[]>;
  activeTasksByProjectId: Record<string, Task[]>;
  archivedTasksByProjectId: Record<string, Task[]>;
}

const TasksDataContext = createContext<TasksDataContextValue | null>(null);

export function useTasksDataContext(): TasksDataContextValue {
  const ctx = useContext(TasksDataContext);
  if (!ctx) {
    throw new Error('useTasksContext must be used within a TasksContext.Provider');
  }
  return ctx;
}

export function useTearingDownTaskIds(projectId: string) {
  const { data } = useQuery({
    queryKey: ['tearing-down-tasks', projectId],
    queryFn: () => rpc.tasks.getTearingDownTaskIds(projectId),
    refetchInterval: (query) => (query.state.data?.length ? 1000 : false),
  });
  return useMemo(() => new Set(data ?? []), [data]);
}

export function TasksDataProvider({ children }: { children: React.ReactNode }) {
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

  const activeTasksByProjectId = useMemo(() => {
    return (tasks ?? [])
      .filter((t) => !t.archivedAt)
      .reduce(
        (acc, t) => {
          acc[t.projectId] = [...(acc[t.projectId] ?? []), t];
          return acc;
        },
        {} as Record<string, Task[]>
      );
  }, [tasks]);

  const archivedTasksByProjectId = useMemo(() => {
    return (tasks ?? [])
      .filter((t) => Boolean(t.archivedAt))
      .reduce(
        (acc, t) => {
          acc[t.projectId] = [...(acc[t.projectId] ?? []), t];
          return acc;
        },
        {} as Record<string, Task[]>
      );
  }, [tasks]);

  return (
    <TasksDataContext.Provider
      value={{
        tasks: tasks ?? [],
        tasksByProjectId,
        activeTasksByProjectId,
        archivedTasksByProjectId,
      }}
    >
      {children}
    </TasksDataContext.Provider>
  );
}
