import type { InstallMethod } from '@emdash/shared/deps';
import type {
  DependencyId,
  DependencyStatus,
  DependencyStatusUpdatedEvent,
  HostDependency,
  HostDependencySelection,
  Installation,
} from '@emdash/shared/deps/runtime';
import { deriveHostDependencyStatus } from '@emdash/shared/deps/runtime';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';
import { events, rpc } from '@renderer/lib/ipc';
import type { AgentInstallationStatus, AgentPayload } from '@shared/core/agents/agent-payload';
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
    installingMethod: installMutation.isPending ? installMutation.variables?.method : undefined,
    updatingMethod: updateMutation.isPending ? updateMutation.variables?.method : undefined,
  };
}

/**
 * Per-agent view-model derived from `useAgentInstallationStatuses`. Provides the
 * single agent's installation list, the currently used installation, a derived
 * status, and agent-bound, awaitable action wrappers. Consumed by the install
 * cards as the single source of truth (`vm`).
 */
export type HostDependencyInstallation = {
  installations: Installation[];
  used: Installation | undefined;
  status: DependencyStatus;
  hostDependency: HostDependency | undefined;
  /** True while an install mutation is in flight for this host. */
  isInstalling: boolean;
  /** True while an update mutation is in flight for this host. */
  isUpdating: boolean;
  /** The install method currently being installed, if any. */
  installingMethod: InstallMethod | undefined;
  /** The install method currently being updated, if any. */
  updatingMethod: InstallMethod | undefined;
  install(method: InstallMethod): Promise<void>;
  update(method: InstallMethod): Promise<void>;
  setUsed(selection: HostDependencySelection): Promise<void>;
  refresh(): Promise<void>;
  fetchLatestVersion(): Promise<void>;
};

/**
 * Returns the installation status and full per-agent view-model for a single
 * agent. `agentPayload` (optional) hydrates a synthetic installation before the
 * first probe completes so the UI can render immediately.
 */
export function useAgentInstallationStatus(
  id: string,
  connectionId?: string,
  agentPayload?: AgentPayload
) {
  const base = useAgentInstallationStatuses(connectionId);
  const {
    data: statuses,
    install: installMutate,
    update: updateMutate,
    setUsedInstallation,
    refreshLatestVersion,
    probeAll,
  } = base;

  const statusEntry = statuses?.find((s) => s.id === id) ?? null;

  const hostDependency: HostDependency | undefined = statusEntry
    ? {
        hostId: connectionId ?? 'local',
        dependencyId: id as DependencyId,
        installations: statusEntry.installations,
        usedId: statusEntry.usedId,
      }
    : undefined;

  const installations = useMemo<Installation[]>(() => {
    if (hostDependency) return hostDependency.installations;
    if (!agentPayload) return [];
    return [
      {
        id: 'auto',
        source: { kind: 'cli' as const, command: agentPayload.id },
        status: agentPayload.status,
        path: agentPayload.command,
        version: agentPayload.version,
        latestVersion: agentPayload.latestVersion,
        updateAvailable: agentPayload.updateAvailable,
      },
    ];
  }, [hostDependency, agentPayload]);

  const usedId = hostDependency?.usedId ?? agentPayload?.usedId;
  const used = useMemo(() => installations.find((i) => i.id === usedId), [installations, usedId]);

  const status = useMemo<DependencyStatus>(() => {
    if (hostDependency) return deriveHostDependencyStatus(hostDependency);
    return agentPayload?.status ?? 'missing';
  }, [hostDependency, agentPayload]);

  const install = useCallback(
    (method: InstallMethod) =>
      new Promise<void>((resolve) => {
        installMutate({ id: id as AgentProviderId, method }, { onSettled: () => resolve() });
      }),
    [installMutate, id]
  );

  const update = useCallback(
    (method: InstallMethod) =>
      new Promise<void>((resolve) => {
        updateMutate({ id: id as AgentProviderId, method }, { onSettled: () => resolve() });
      }),
    [updateMutate, id]
  );

  const setUsed = useCallback(
    (selection: HostDependencySelection) =>
      new Promise<void>((resolve) => {
        setUsedInstallation({ id, selection }, { onSettled: () => resolve() });
      }),
    [setUsedInstallation, id]
  );

  const refresh = useCallback(
    () =>
      new Promise<void>((resolve) => {
        probeAll(undefined, { onSettled: () => resolve() });
      }),
    [probeAll]
  );

  const fetchLatestVersion = useCallback(
    () =>
      new Promise<void>((resolve) => {
        refreshLatestVersion(id, { onSettled: () => resolve() });
      }),
    [refreshLatestVersion, id]
  );

  return {
    ...base,
    data: statusEntry,
    installations,
    used,
    status,
    hostDependency,
    install,
    update,
    setUsed,
    refresh,
    fetchLatestVersion,
  };
}
