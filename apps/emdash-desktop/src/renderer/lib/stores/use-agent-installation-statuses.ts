import type { InstallMethod } from '@emdash/shared/deps';
import type {
  DependencyStatusUpdatedEvent,
  HostDependencySelection,
} from '@emdash/shared/deps/runtime';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { events, rpc } from '@renderer/lib/ipc';
import type { AgentInstallationStatus } from '@shared/core/agents/agent-payload';
import type { AgentProviderId } from '@shared/core/agents/agent-provider-registry';
import { agentInstallationStatusUpdatedChannel } from '@shared/events/appEvents';
import { AGENTS_METADATA_QUERY_KEY } from './use-agents';

function statusQueryKey(connectionId?: string) {
  return ['agents', 'status', connectionId ?? 'local'] as const;
}

/**
 * Returns installation statuses for all agents on the given host, and provides
 * mutations for install, update, setUsedInstallation, refreshLatestVersion, and probeAll.
 *
 * Also subscribes to `agentInstallationStatusUpdatedChannel` to keep the cache
 * live-patched when the main process emits status changes.
 */
export function useAgentInstallationStatuses(connectionId?: string) {
  const queryClient = useQueryClient();
  const key = statusQueryKey(connectionId);

  const query = useQuery<AgentInstallationStatus[]>({
    queryKey: key,
    queryFn: () =>
      rpc.agents.listAgentInstallationStatus(connectionId) as Promise<AgentInstallationStatus[]>,
    staleTime: 30_000,
  });

  // Live-patch cache from background events
  useEffect(() => {
    const stop = events.on(
      agentInstallationStatusUpdatedChannel,
      (event: DependencyStatusUpdatedEvent) => {
        if ((event.connectionId ?? undefined) !== connectionId) return;
        queryClient.setQueryData<AgentInstallationStatus[]>(key, (prev) => {
          if (!prev) return prev;
          return prev.map((s) => {
            if (s.id !== event.id) return s;
            return {
              ...s,
              status: event.state.status,
              version: event.state.version,
              latestVersion: event.state.latestVersion ?? null,
              updateAvailable: event.state.updateAvailable ?? false,
              command: event.state.path,
              installations: event.hostDependency?.installations ?? s.installations,
              usedId: event.hostDependency?.usedId ?? s.usedId,
            };
          });
        });
        // Also invalidate the full agents list to keep the combined payload consistent
        void queryClient.invalidateQueries({ queryKey: AGENTS_METADATA_QUERY_KEY });
      }
    );
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: key });
  };

  const installMutation = useMutation<
    unknown,
    Error,
    { id: AgentProviderId; method?: InstallMethod }
  >({
    mutationFn: ({ id, method }) =>
      rpc.agents.install(id, connectionId, method) as Promise<unknown>,
    onSuccess: invalidate,
  });

  const updateMutation = useMutation<
    unknown,
    Error,
    { id: AgentProviderId; method?: InstallMethod }
  >({
    mutationFn: ({ id, method }) => rpc.agents.update(id, connectionId, method) as Promise<unknown>,
    onSuccess: invalidate,
  });

  const setUsedMutation = useMutation<
    void,
    Error,
    { id: string; selection: HostDependencySelection }
  >({
    mutationFn: ({ id, selection }) =>
      rpc.agents.setUsedInstallation(id, connectionId, selection) as Promise<void>,
    onSuccess: invalidate,
  });

  const refreshLatestMutation = useMutation<void, Error, string>({
    mutationFn: (id) => rpc.agents.refreshLatestVersion(id, connectionId) as Promise<void>,
    onSuccess: invalidate,
  });

  const probeAllMutation = useMutation<void, Error, void>({
    mutationFn: () => rpc.agents.probeAll(connectionId) as Promise<void>,
    onSuccess: invalidate,
  });

  return {
    ...query,
    install: installMutation.mutate,
    update: updateMutation.mutate,
    setUsedInstallation: setUsedMutation.mutate,
    refreshLatestVersion: refreshLatestMutation.mutate,
    probeAll: probeAllMutation.mutate,
    isInstalling: installMutation.isPending,
    isUpdating: updateMutation.isPending,
  };
}

/**
 * Returns the installation status for a single agent.
 */
export function useAgentInstallationStatus(id: string, connectionId?: string) {
  const { data, ...rest } = useAgentInstallationStatuses(connectionId);
  return { data: data?.find((s) => s.id === id) ?? null, ...rest };
}
