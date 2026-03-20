import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { createContext, useCallback, useContext, useMemo } from 'react';
import { Task } from '@shared/tasks';
import { rpc } from '@renderer/core/ipc';

interface TasksDataContextValue {
  tasks: Task[];
  tasksByProjectId: Record<string, Task[]>;
  activeTasksByProjectId: Record<string, Task[]>;
  archiveTask: (projectId: string, taskId: string) => Promise<void>;
  restoreTask: (taskId: string) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
}

const TasksDataContext = createContext<TasksDataContextValue | null>(null);

export function useTasksDataContext(): TasksDataContextValue {
  const ctx = useContext(TasksDataContext);
  if (!ctx) {
    throw new Error('useTasksContext must be used within a TasksContext.Provider');
  }
  return ctx;
}

export function TasksDataProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

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

  const invalidateTasks = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
  }, [queryClient]);

  const archiveTaskMutation = useMutation({
    mutationFn: ({ projectId, taskId }: { projectId: string; taskId: string }) =>
      rpc.tasks.archiveTask(projectId, taskId),
    onSuccess: invalidateTasks,
  });

  const restoreTaskMutation = useMutation({
    mutationFn: (taskId: string) => rpc.tasks.restoreTask(taskId),
    onSuccess: invalidateTasks,
  });

  const deleteTaskMutation = useMutation({
    mutationFn: (taskId: string) => rpc.tasks.deleteTask(taskId),
    onSuccess: invalidateTasks,
  });

  const archiveTask = useCallback(
    (projectId: string, taskId: string) => archiveTaskMutation.mutateAsync({ projectId, taskId }),
    [archiveTaskMutation]
  );

  const restoreTask = useCallback(
    (taskId: string) => restoreTaskMutation.mutateAsync(taskId),
    [restoreTaskMutation]
  );

  const deleteTask = useCallback(
    (taskId: string) => deleteTaskMutation.mutateAsync(taskId),
    [deleteTaskMutation]
  );

  return (
    <TasksDataContext.Provider
      value={{
        tasks: tasks ?? [],
        tasksByProjectId,
        activeTasksByProjectId,
        archiveTask,
        restoreTask,
        deleteTask,
      }}
    >
      {children}
    </TasksDataContext.Provider>
  );
}
