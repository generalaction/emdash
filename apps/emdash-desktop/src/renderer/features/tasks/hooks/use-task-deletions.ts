import { createLiveModelReplica } from '@emdash/wire';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getTasksWireClient } from '@renderer/lib/runtime/tasks-wire-client';
import type { DeletionList } from '@shared/core/operations/deletion';
import { tasksWireContract } from '@shared/core/tasks/wire-contract';

export function useTaskDeletions(projectId?: string): {
  deletions: DeletionList;
  isLoading: boolean;
  retryDelete(taskId: string): Promise<void>;
  forgetWithoutCleanup(taskId: string): Promise<void>;
} {
  const [deletions, setDeletions] = useState<DeletionList>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void (async () => {
      const client = await getTasksWireClient();
      if (disposed) return;
      const replica = createLiveModelReplica(tasksWireContract.deletions, client.deletions, {
        onChange: { list: (list: DeletionList) => setDeletions(list) },
      });
      const lease = replica.acquire({});
      cleanup = () => {
        void lease.release();
        void replica.dispose();
      };
      const model = await lease.ready();
      if (disposed) {
        cleanup();
        return;
      }
      setDeletions((await model.states.list.snapshot()).data as DeletionList);
      setIsLoading(false);
    })();
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  const filtered = useMemo(
    () =>
      projectId
        ? Object.fromEntries(
            Object.entries(deletions).filter(([, deletion]) => deletion.projectId === projectId)
          )
        : deletions,
    [deletions, projectId]
  );

  const retryDelete = useCallback(async (taskId: string) => {
    const result = await (await getTasksWireClient()).retryDelete({ taskId });
    if (!result.success) throw new Error(result.error.message);
  }, []);

  const forgetWithoutCleanup = useCallback(async (taskId: string) => {
    const result = await (await getTasksWireClient()).forgetWithoutCleanup({ taskId });
    if (!result.success) throw new Error(result.error.message);
  }, []);

  return { deletions: filtered, isLoading, retryDelete, forgetWithoutCleanup };
}
