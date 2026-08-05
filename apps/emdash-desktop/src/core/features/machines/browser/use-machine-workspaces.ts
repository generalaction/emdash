import { createScope } from '@emdash/shared/concurrency';
import { observe, remote } from '@emdash/wire';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { projectWorkspacesContract } from '@core/features/workspaces/api';
import type {
  HostWorkspaceGroup,
  MeasureProjectWorkspacesResult,
} from '@core/primitives/workspaces/api';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';

/** Which host's workspaces to read: this device or a remote machine. */
export type WorkspacesScope = { kind: 'local' } | { kind: 'machine'; machineId: string };

export type MachineProjectWorkspaces = HostWorkspaceGroup;

type WorkspaceGroupsState = {
  data?: MachineProjectWorkspaces[];
  error?: unknown;
};

/**
 * Mirror-served workspace groups, live: the node-side family re-queries on app-db
 * pokes (the registry sync pokes on every applied host snapshot), so host-side
 * changes stream in without any pull loop. Works from the cached mirror while the
 * host is unreachable — staleness shows through each row's `lastObservedAt`.
 */
export function useWorkspaceGroups(scope: WorkspacesScope, enabled: boolean) {
  const hostKey = scope.kind === 'local' ? 'local' : `ssh:${scope.machineId}`;
  const [state, setState] = useState<WorkspaceGroupsState>({});

  useEffect(() => {
    if (!enabled) return;
    setState({});
    const subscription = createScope({ label: `workspace-groups:${hostKey}` });
    let cancelled = false;
    void (async () => {
      const client = await getDesktopWireClient();
      if (cancelled) return;
      const groups = remote(
        projectWorkspacesContract.workspaceGroups,
        client.projectWorkspaces.workspaceGroups,
        { scope: subscription }
      );
      observe(
        groups({ hostKey }).states.list,
        (current) => {
          if (current.status === 'error') {
            setState({ error: current.error ?? new Error('Could not load workspaces.') });
          } else if (current.value) {
            setState({ data: current.value.groups });
          }
        },
        { scope: subscription }
      );
    })();
    return () => {
      cancelled = true;
      void subscription.dispose();
    };
  }, [enabled, hostKey]);

  return {
    data: state.data,
    isLoading: enabled && state.data === undefined && state.error === undefined,
    isError: state.error !== undefined,
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

export async function getMachineOperationsClient() {
  return (await getDesktopWireClient()).operations;
}
