import { useQueryClient } from '@tanstack/react-query';
import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { CreateTaskParams, Task } from '@shared/tasks';
import { rpc } from '@renderer/core/ipc';
import { useTasksDataContext } from './tasks-data-provider';

export interface PendingTask {
  id: string;
  projectId: string;
  name: string;
  status: 'pending' | 'error';
  error?: string;
}

export interface TaskError {
  kind: 'create' | 'provision' | 'teardown';
  type: 'timeout' | 'error';
  message: string;
}

export type TaskStatus =
  | 'creating'
  | 'create-error'
  | 'provisioning'
  | 'provision-error'
  | 'teardown'
  | 'teardown-error'
  | 'ready';

export type LifecycleTask =
  | { status: 'creating'; task: PendingTask }
  | { status: 'create-error'; task: PendingTask | Task; error: TaskError }
  | { status: 'provisioning'; task: PendingTask | Task }
  | { status: 'provision-error'; task: PendingTask | Task; error: TaskError }
  | { status: 'teardown'; task: Task }
  | { status: 'teardown-error'; task: Task; error: TaskError }
  | { status: 'ready'; task: Task };

interface TaskLifecycleContextValue {
  taskStatus: Record<string, TaskStatus>;
  taskErrors: Record<string, TaskError>;
  pendingTasks: Record<string, PendingTask>;
  createTask: (params: CreateTaskParams) => void;
  provisionTask: (taskId: string) => void;
  archiveTask: (projectId: string, taskId: string) => void;
  restoreTask: (taskId: string) => void;
  deleteTask: (projectId: string, taskId: string) => void;
  renameTask: (projectId: string, taskId: string, newName: string) => Promise<void>;
}

const TaskLifecycleContext = createContext<TaskLifecycleContextValue | null>(null);

export function TaskLifecycleProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const [taskStatus, setTaskStatus] = useState<Record<string, TaskStatus>>({});
  const [taskErrors, setTaskErrors] = useState<Record<string, TaskError>>({});
  const [pendingTasks, setPendingTasks] = useState<Record<string, PendingTask>>({});

  const provisionTask = useCallback(
    (taskId: string) => {
      const current = taskStatus[taskId];
      if (current === 'creating' || current === 'provisioning' || current === 'ready') return;
      if (current === 'provision-error') return;

      setTaskStatus((prev) => ({ ...prev, [taskId]: 'provisioning' }));
      setTaskErrors((prev) => {
        const next = { ...prev };
        delete next[taskId];
        return next;
      });

      rpc.tasks
        .provisionTask(taskId)
        .then(() => {
          setTaskStatus((prev) => ({ ...prev, [taskId]: 'ready' }));
          setPendingTasks((prev) => {
            if (!prev[taskId]) return prev;
            const next = { ...prev };
            delete next[taskId];
            return next;
          });
        })
        .catch((e: unknown) => {
          setTaskStatus((prev) => ({ ...prev, [taskId]: 'provision-error' }));
          setTaskErrors((prev) => ({
            ...prev,
            [taskId]: { kind: 'provision', type: 'error', message: String(e) },
          }));
        });
    },
    [taskStatus]
  );

  const createTask = useCallback(
    (params: CreateTaskParams) => {
      const pending: PendingTask = {
        id: params.id,
        projectId: params.projectId,
        name: params.name,
        status: 'pending',
      };
      setPendingTasks((prev) => ({ ...prev, [params.id]: pending }));
      setTaskStatus((prev) => ({ ...prev, [params.id]: 'creating' }));

      rpc.tasks
        .createTask(params)
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ['tasks'] });
          provisionTask(params.id);
        })
        .catch((e: unknown) => {
          setPendingTasks((prev) => ({
            ...prev,
            [params.id]: { ...pending, status: 'error', error: String(e) },
          }));
          setTaskStatus((prev) => ({ ...prev, [params.id]: 'create-error' }));
          setTaskErrors((prev) => ({
            ...prev,
            [params.id]: { kind: 'create', type: 'error', message: String(e) },
          }));
        });
    },
    [queryClient, provisionTask]
  );

  const archiveTask = useCallback(
    (projectId: string, taskId: string) => {
      if (taskStatus[taskId] === 'teardown') return;

      setTaskStatus((prev) => ({ ...prev, [taskId]: 'teardown' }));
      setTaskErrors((prev) => {
        const next = { ...prev };
        delete next[taskId];
        return next;
      });

      queryClient.setQueryData<Task[]>(['tasks'], (old) =>
        old?.map((t) =>
          t.id === taskId
            ? { ...t, archivedAt: new Date().toISOString(), status: 'archived' as const }
            : t
        )
      );

      rpc.tasks
        .archiveTask(projectId, taskId)
        .then(async () => {
          await queryClient.invalidateQueries({ queryKey: ['tasks'] });
          setTaskStatus((prev) => {
            const next = { ...prev };
            delete next[taskId];
            return next;
          });
        })
        .catch((e: unknown) => {
          setTaskStatus((prev) => ({ ...prev, [taskId]: 'teardown-error' }));
          setTaskErrors((prev) => ({
            ...prev,
            [taskId]: { kind: 'teardown', type: 'error', message: String(e) },
          }));
        });
    },
    [queryClient, taskStatus]
  );

  const restoreTask = useCallback(
    (taskId: string) => {
      setTaskStatus((prev) => ({ ...prev, [taskId]: 'provisioning' }));
      setTaskErrors((prev) => {
        const next = { ...prev };
        delete next[taskId];
        return next;
      });

      rpc.tasks
        .restoreTask(taskId)
        .then(() => queryClient.invalidateQueries({ queryKey: ['tasks'] }))
        .then(() => rpc.tasks.provisionTask(taskId))
        .then(() => {
          setTaskStatus((prev) => ({ ...prev, [taskId]: 'ready' }));
        })
        .catch((e: unknown) => {
          setTaskStatus((prev) => ({ ...prev, [taskId]: 'provision-error' }));
          setTaskErrors((prev) => ({
            ...prev,
            [taskId]: { kind: 'provision', type: 'error', message: String(e) },
          }));
        });
    },
    [queryClient]
  );

  const deleteTask = useCallback(
    (projectId: string, taskId: string) => {
      queryClient.setQueryData<Task[]>(['tasks'], (old) => old?.filter((t) => t.id !== taskId));
      setTaskStatus((prev) => {
        const next = { ...prev };
        delete next[taskId];
        return next;
      });
      setTaskErrors((prev) => {
        const next = { ...prev };
        delete next[taskId];
        return next;
      });

      rpc.tasks.deleteTask(projectId, taskId).catch((e: unknown) => {
        console.warn('deleteTask failed', taskId, e);
      });
    },
    [queryClient]
  );

  const renameTask = useCallback(
    async (projectId: string, taskId: string, newName: string) => {
      await rpc.tasks.renameTask(projectId, taskId, newName);
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    [queryClient]
  );

  return (
    <TaskLifecycleContext.Provider
      value={{
        taskStatus,
        taskErrors,
        pendingTasks,
        createTask,
        provisionTask,
        archiveTask,
        restoreTask,
        deleteTask,
        renameTask,
      }}
    >
      {children}
    </TaskLifecycleContext.Provider>
  );
}

export function useTaskLifecycleContext(): TaskLifecycleContextValue {
  const context = useContext(TaskLifecycleContext);
  if (!context) {
    throw new Error('useTaskLifecycleContext must be used within a TaskLifecycleProvider');
  }
  return context;
}

export function useTask({
  projectId,
  taskId,
}: {
  projectId: string;
  taskId: string;
}): LifecycleTask {
  const { taskStatus, taskErrors, pendingTasks } = useTaskLifecycleContext();
  const { tasksByProjectId } = useTasksDataContext();
  return useMemo((): LifecycleTask => {
    const status = taskStatus[taskId];
    const error = taskErrors[taskId];
    const pendingTask = pendingTasks[taskId];

    if (!status || status === 'creating') {
      const pt = pendingTask ?? { id: taskId, projectId, name: '', status: 'pending' as const };
      return { status: 'creating', task: pt };
    }
    if (status === 'create-error') {
      const pt = pendingTask ?? { id: taskId, projectId, name: '', status: 'error' as const };
      return { status: 'create-error', task: pt, error: error! };
    }

    const dbTask = (tasksByProjectId[projectId] ?? []).find((t) => t.id === taskId);
    if (!dbTask) {
      const pt = pendingTask ?? { id: taskId, projectId, name: '', status: 'pending' as const };
      return { status: 'creating', task: pt };
    }

    if (status === 'provisioning') return { status: 'provisioning', task: dbTask };
    if (status === 'provision-error')
      return { status: 'provision-error', task: dbTask, error: error! };
    if (status === 'teardown') return { status: 'teardown', task: dbTask };
    if (status === 'teardown-error')
      return { status: 'teardown-error', task: dbTask, error: error! };

    return { status: 'ready', task: dbTask };
  }, [taskStatus, taskErrors, pendingTasks, tasksByProjectId, projectId, taskId]);
}
