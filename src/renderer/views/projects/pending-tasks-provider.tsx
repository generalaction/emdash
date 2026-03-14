import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { CreateTaskParams, TaskLifecycleStatus } from '@shared/tasks';
import { rpc } from '@renderer/lib/ipc';

interface PendingTasksContextValue {
  createTask: (params: CreateTaskParams) => Promise<void>;
  pendingTasks: PendingTask[];
  pendingTasksByProjectId: Record<string, PendingTask[]>;
}

const PendingTasksContext = createContext<PendingTasksContextValue | null>(null);

export interface PendingTask {
  id: string;
  projectId: string;
  name: string;
  status: TaskLifecycleStatus;
  state: 'initializing' | 'creating-worktree' | 'setup';
}

export function PendingTasksProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const createTaskMutation = useMutation({
    mutationFn: rpc.tasks.createTask,
    onSuccess: (data) => {
      queryClient.setQueryData(['tasks'], data);
    },
  });

  const [pendingTasks, setPendingTasks] = useState<PendingTask[]>([]);

  const pendingTasksByProjectId = useMemo(() => {
    return pendingTasks.reduce(
      (acc, task) => {
        acc[task.projectId] = [...(acc[task.projectId] || []), task];
        return acc;
      },
      {} as Record<string, PendingTask[]>
    );
  }, [pendingTasks]);

  const createTask = useCallback(
    async (params: CreateTaskParams) => {
      const id = crypto.randomUUID();
      setPendingTasks((prev) => [
        ...prev,
        { id, ...params, status: 'todo', state: 'initializing' },
      ]);
      await createTaskMutation.mutateAsync(params);
      setPendingTasks((prev) => prev.filter((t) => t.id !== id));
    },
    [createTaskMutation]
  );

  return (
    <PendingTasksContext.Provider
      value={{
        createTask,
        pendingTasks,
        pendingTasksByProjectId,
      }}
    >
      {children}
    </PendingTasksContext.Provider>
  );
}

export function usePendingTasksContext() {
  const context = useContext(PendingTasksContext);
  if (!context) {
    throw new Error('usePendingTasksContext must be used within a PendingTasksProvider');
  }
  return context;
}
