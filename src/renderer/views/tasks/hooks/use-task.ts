import { useMemo } from 'react';
import { useTasksContext } from '@renderer/features/tasks/tasks-provider';
import {
  PendingTask,
  usePendingTasksContext,
} from '@renderer/views/projects/pending-tasks-provider';

export type TaskStatus =
  | {
      status: 'ready';
    }
  | {
      status: 'pending';
      pendingTask: PendingTask;
    };

export function useTask({ projectId, taskId }: { projectId: string; taskId: string }) {
  const { tasksByProjectId } = useTasksContext();
  const { pendingTasksByProjectId } = usePendingTasksContext();

  const taskStatus: TaskStatus = useMemo(() => {
    const isReady = (tasksByProjectId[projectId] ?? []).some((t) => t.id === taskId);
    if (isReady) return { status: 'ready' };
    const pendingTask =
      pendingTasksByProjectId[projectId]?.find((task) => task.id === taskId) ?? null;
    if (pendingTask) return { status: 'pending', pendingTask };
    return { status: 'ready' };
  }, [tasksByProjectId, pendingTasksByProjectId, projectId, taskId]);

  const task = useMemo(() => {
    if (taskStatus.status === 'ready') {
      return tasksByProjectId[projectId]?.find((task) => task.id === taskId) ?? null;
    }
  }, [taskStatus.status, tasksByProjectId, projectId, taskId]);

  return { taskStatus, task };
}
