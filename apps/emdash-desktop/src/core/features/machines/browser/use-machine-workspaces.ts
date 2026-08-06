import { remote, type RemoteModel } from '@emdash/wire';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { projectWorkspacesContract } from '@core/features/workspaces/api';
import { useRemoteModelState } from '@core/primitives/wire/browser/use-remote-model-state';
import type {
  HostWorkspaceGroup,
  MeasureProjectWorkspacesResult,
} from '@core/primitives/workspaces/api';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';

/** Which host's workspaces to read: this device or a remote machine. */
export type WorkspacesScope = { kind: 'local' } | { kind: 'machine'; machineId: string };

export type MachineProjectWorkspaces = HostWorkspaceGroup;

let workspaceGroupsRemotePromise:
  | Promise<RemoteModel<typeof projectWorkspacesContract.workspaceGroups>>
  | undefined;

function getWorkspaceGroupsRemote(): Promise<
  RemoteModel<typeof projectWorkspacesContract.workspaceGroups>
> {
  workspaceGroupsRemotePromise ??= getDesktopWireClient().then((client) =>
    remote(projectWorkspacesContract.workspaceGroups, client.projectWorkspaces.workspaceGroups, {
      lingerMs: 15_000,
    })
  );
  return workspaceGroupsRemotePromise;
}

/**
 * Mirror-served workspace groups, live: the node-side family re-queries on app-db
 * pokes (the registry sync pokes on every applied host snapshot), so host-side
 * changes stream in without any pull loop. Works from the cached mirror while the
 * host is unreachable — staleness shows through each row's `lastObservedAt`.
 */
export function useWorkspaceGroups(scope: WorkspacesScope, enabled: boolean) {
  const hostKey = scope.kind === 'local' ? 'local' : `ssh:${scope.machineId}`;
  const key = useMemo(() => ({ hostKey }), [hostKey]);
  const state = useRemoteModelState(
    projectWorkspacesContract.workspaceGroups,
    getWorkspaceGroupsRemote,
    key,
    'list',
    { enabled }
  );

  return {
    data: state.value?.groups,
    isLoading: enabled && state.isLoading,
    isError: state.status === 'error',
    error: state.error,
  };
}

export function useProjectWorkspaceUsage(
  projectId: string | undefined,
  paths: readonly string[],
  enabled: boolean
) {
  return useQuery({
    queryKey: ['projectWorkspaceUsage', projectId, paths],
    queryFn: async (): Promise<MeasureProjectWorkspacesResult> => {
      if (!projectId) return { scannedAt: new Date().toISOString(), projectId: '', results: [] };
      const client = await getDesktopWireClient();
      return await client.projectWorkspaces.measureProjectWorkspaces({
        projectId,
        paths: Array.from(paths),
      });
    },
    enabled: enabled && !!projectId && paths.length > 0,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
}

export async function deleteMachineProjectWorkspaces({
  projectId,
  paths,
  deleteConversations,
}: {
  projectId: string;
  paths: string[];
  deleteConversations?: boolean;
}) {
  return (await getDesktopWireClient()).projectWorkspaces.deleteProjectWorkspaces({
    projectId,
    paths,
    deleteConversations,
  });
}
