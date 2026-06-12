import type { InstallMethod } from '@emdash/shared/deps';
import type {
  DependencyId,
  DependencyStatus,
  HostDependency,
  HostDependencySelection,
  Installation,
} from '@emdash/shared/deps/runtime';
import { deriveHostDependencyStatus } from '@emdash/shared/deps/runtime';
import { useCallback, useMemo } from 'react';
import type { AgentPayload } from '@shared/core/agents/agent-payload';
import { useAgentInstallationStatuses } from './use-agent-installation-statuses';

export type HostDependencyInstallationActions = {
  install(method: InstallMethod): Promise<void>;
  update(method: InstallMethod): Promise<void>;
  setUsed(selection: HostDependencySelection): Promise<void>;
  refresh(): Promise<void>;
  fetchLatestVersion(): Promise<void>;
};

export type HostDependencyInstallation = {
  installations: Installation[];
  used: Installation | undefined;
  status: DependencyStatus;
  operation: undefined;
  hostDependency: HostDependency | undefined;
} & HostDependencyInstallationActions;

export function useHostDependencyInstallation(
  agentId: DependencyId,
  connectionId: string | undefined,
  agentPayload: AgentPayload | undefined
): HostDependencyInstallation {
  const {
    data: statuses,
    install: installMutate,
    update: updateMutate,
    setUsedInstallation,
    refreshLatestVersion,
    probeAll,
  } = useAgentInstallationStatuses(connectionId);

  const statusEntry = statuses?.find((s) => s.id === agentId);

  const hostDependency: HostDependency | undefined = statusEntry
    ? {
        hostId: connectionId ?? 'local',
        dependencyId: agentId,
        installations: statusEntry.installations,
        usedId: statusEntry.usedId,
      }
    : undefined;

  const installations = useMemo(() => {
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
      } satisfies Installation,
    ];
  }, [hostDependency, agentPayload]);

  const usedId = hostDependency?.usedId ?? agentPayload?.usedId;
  const used = useMemo(() => installations.find((i) => i.id === usedId), [installations, usedId]);

  const status = useMemo((): DependencyStatus => {
    if (hostDependency) return deriveHostDependencyStatus(hostDependency);
    return agentPayload?.status ?? 'missing';
  }, [hostDependency, agentPayload]);

  const install = useCallback(
    (method: InstallMethod) =>
      new Promise<void>((resolve) => {
        installMutate({ id: agentId as never, method }, { onSettled: () => resolve() });
      }),
    [installMutate, agentId]
  );

  const update = useCallback(
    (method: InstallMethod) =>
      new Promise<void>((resolve) => {
        updateMutate({ id: agentId as never, method }, { onSettled: () => resolve() });
      }),
    [updateMutate, agentId]
  );

  const setUsed = useCallback(
    (selection: HostDependencySelection) =>
      new Promise<void>((resolve) => {
        setUsedInstallation({ id: agentId, selection }, { onSettled: () => resolve() });
      }),
    [setUsedInstallation, agentId]
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
        refreshLatestVersion(agentId, { onSettled: () => resolve() });
      }),
    [refreshLatestVersion, agentId]
  );

  return {
    installations,
    used,
    status,
    operation: undefined,
    hostDependency,
    install,
    update,
    setUsed,
    refresh,
    fetchLatestVersion,
  };
}
