import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { createContext, useCallback, useContext } from 'react';
import { CreateTaskParams, Task } from '@shared/tasks';
import { rpc } from '@renderer/lib/ipc';
import { useWorkspaceNavigation } from './WorkspaceNavigationContext';

interface TasksContextValue {
  tasks: Task[];
  createTask: (params: CreateTaskParams) => Promise<void>;
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
  const queryClient = useQueryClient();
  const { navigate } = useWorkspaceNavigation();

  const { data: tasks } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => rpc.tasks.getTasks(),
  });

  const createTaskMutation = useMutation({
    mutationFn: rpc.tasks.createTask,
    onSuccess: (data) => {
      queryClient.setQueryData(['tasks'], data);
    },
  });

  const createTask = useCallback(
    async (params: CreateTaskParams) => {
      const task = await createTaskMutation.mutateAsync(params);
      navigate('task', { projectId: task.projectId, taskId: task.id });
    },
    [createTaskMutation, navigate]
  );

  return (
    <TasksContext.Provider value={{ tasks: tasks ?? [], createTask }}>
      {children}
    </TasksContext.Provider>
  );
}
