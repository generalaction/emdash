import { useMemo } from 'react';
import { useTaskBootstrapContext } from '@renderer/core/tasks/task-bootstrap-provider';
import { useTasksDataContext } from '@renderer/core/tasks/tasks-data-provider';
import {
  PendingTask,
  usePendingTasksContext,
} from '@renderer/views/projects/pending-tasks-provider';

export type TaskStatus =
  | { status: 'ready' }
  | { status: 'pending'; pendingTask?: PendingTask }
  | { status: 'bootstrapping' }
  | { status: 'error'; message: string };

export function useTask({ projectId, taskId }: { projectId: string; taskId: string }) {
  const { tasksByProjectId } = useTasksDataContext();
  const { pendingTasksByProjectId } = usePendingTasksContext();
  const { entries } = useTaskBootstrapContext();

  const taskStatus: TaskStatus = useMemo(() => {
    const pendingTask =
      pendingTasksByProjectId[projectId]?.find((task) => task.id === taskId) ?? null;
    if (pendingTask) return { status: 'pending', pendingTask };

    const isInDb = (tasksByProjectId[projectId] ?? []).some((t) => t.id === taskId);
    if (!isInDb) return { status: 'pending' };

    const bootstrapEntry = entries[taskId];
    if (bootstrapEntry?.status === 'error') {
      return { status: 'error', message: bootstrapEntry.error ?? 'Bootstrap failed' };
    }
    if (bootstrapEntry?.status === 'bootstrapping') {
      return { status: 'bootstrapping' };
    }

    return { status: 'ready' };
  }, [tasksByProjectId, pendingTasksByProjectId, entries, projectId, taskId]);

  const task = useMemo(() => {
    if (taskStatus.status === 'ready') {
      return tasksByProjectId[projectId]?.find((task) => task.id === taskId) ?? null;
    }
  }, [taskStatus.status, tasksByProjectId, projectId, taskId]);

  return { taskStatus, task };
}
