import { createLiveModelReplica } from '@emdash/wire';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';
import type {
  DeletionEntityKind,
  DeletionList,
  DeletionState,
} from '@shared/core/operations/deletion';
import { projectsWireContract } from '@shared/core/projects/wire-contract';
import { tasksWireContract } from '@shared/core/tasks/wire-contract';
import { workspacesWireContract } from '@shared/core/workspaces/wire-contract';

export function usePendingCleanups(projectId: string): {
  cleanups: DeletionState[];
  retry(cleanup: DeletionState): Promise<void>;
  forget(cleanup: DeletionState): Promise<void>;
} {
  const [taskDeletions, setTaskDeletions] = useState<DeletionList>({});
  const [workspaceDeletions, setWorkspaceDeletions] = useState<DeletionList>({});
  const [projectDeletions, setProjectDeletions] = useState<DeletionList>({});

  useEffect(() => {
    let disposed = false;
    const cleanups: Array<() => void> = [];
    void (async () => {
      const client = await getDesktopWireClient();
      if (disposed) return;
      const tasks = createLiveModelReplica(tasksWireContract.deletions, client.tasks.deletions, {
        onChange: { list: (list: DeletionList) => setTaskDeletions(list) },
      });
      const workspaces = createLiveModelReplica(
        workspacesWireContract.deletions,
        client.workspaces.deletions,
        { onChange: { list: (list: DeletionList) => setWorkspaceDeletions(list) } }
      );
      const projects = createLiveModelReplica(
        projectsWireContract.deletions,
        client.projects.deletions,
        { onChange: { list: (list: DeletionList) => setProjectDeletions(list) } }
      );
      const taskLease = tasks.acquire({});
      const workspaceLease = workspaces.acquire({});
      const projectLease = projects.acquire({});
      cleanups.push(() => {
        void taskLease.release();
        void tasks.dispose();
      });
      cleanups.push(() => {
        void workspaceLease.release();
        void workspaces.dispose();
      });
      cleanups.push(() => {
        void projectLease.release();
        void projects.dispose();
      });
      const [taskModel, workspaceModel, projectModel] = await Promise.all([
        taskLease.ready(),
        workspaceLease.ready(),
        projectLease.ready(),
      ]);
      if (disposed) {
        for (const cleanup of cleanups) cleanup();
        return;
      }
      const [taskList, workspaceList, projectList] = await Promise.all([
        taskModel.states.list.snapshot(),
        workspaceModel.states.list.snapshot(),
        projectModel.states.list.snapshot(),
      ]);
      setTaskDeletions(taskList.data as DeletionList);
      setWorkspaceDeletions(workspaceList.data as DeletionList);
      setProjectDeletions(projectList.data as DeletionList);
    })();
    return () => {
      disposed = true;
      for (const cleanup of cleanups) cleanup();
    };
  }, []);

  const cleanups = useMemo(
    () =>
      [
        ...Object.values(taskDeletions),
        ...Object.values(workspaceDeletions),
        ...Object.values(projectDeletions),
      ]
        .filter(
          (cleanup) =>
            cleanup.projectId === projectId &&
            (cleanup.status === 'awaiting-confirmation' ||
              cleanup.status === 'blocked-host-offline' ||
              cleanup.status === 'failed')
        )
        .sort((left, right) => left.createdAt - right.createdAt),
    [projectDeletions, projectId, taskDeletions, workspaceDeletions]
  );

  const mutate = useCallback(
    async (action: 'retryDelete' | 'forgetWithoutCleanup', cleanup: DeletionState) => {
      const client = await getDesktopWireClient();
      const result = await mutateCleanup(client, action, cleanup.entityKind, cleanup.entityId);
      if (!result.success) throw new Error(result.error.message);
    },
    []
  );

  return {
    cleanups,
    retry: useCallback((cleanup) => mutate('retryDelete', cleanup), [mutate]),
    forget: useCallback((cleanup) => mutate('forgetWithoutCleanup', cleanup), [mutate]),
  };
}

async function mutateCleanup(
  client: Awaited<ReturnType<typeof getDesktopWireClient>>,
  action: 'retryDelete' | 'forgetWithoutCleanup',
  kind: DeletionEntityKind,
  entityId: string
) {
  switch (kind) {
    case 'task':
      return client.tasks[action]({ taskId: entityId });
    case 'workspace':
      return client.workspaces[action]({ workspaceId: entityId });
    case 'project':
      return client.projects[action]({ projectId: entityId });
  }
}
