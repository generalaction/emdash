import type { AgentProviderId } from '@emdash/plugins/agents';
import { useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import type {
  AgentInstallationStatus,
  AgentPayload,
  DependencyStatus,
  HostDependencySelection,
  Installation,
  InstallMethod,
  SelectedSource,
} from '@core/primitives/agents/api';
import { toast } from '@renderer/lib/hooks/use-toast';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';
import { useAgents } from './use-agents';

function statusQueryKey(connectionId?: string) {
  return ['agents', 'status', connectionId ?? 'local'] as const;
}

function opKey(op: 'install' | 'update' | 'uninstall', connectionId?: string) {
  return ['agents', op, connectionId ?? 'local'] as const;
}

type OpVars = { id: AgentProviderId; method?: InstallMethod };
const selectOpVars = (m: { state: { variables?: unknown } }) =>
  m.state.variables as OpVars | undefined;

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
  const remoteUnavailable = Boolean(connectionId);

  const { data: agents } = useAgents();
  const agentNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agents ?? []) map.set(a.id, a.name);
    return map;
  }, [agents]);
  const nameOf = (id: string) => agentNameMap.get(id) ?? id;

  const query = useQuery<AgentInstallationStatus[]>({
    queryKey: key,
    queryFn: async () =>
      remoteUnavailable
        ? Promise.resolve([])
        : (await getDesktopWireClient()).agents.listAgentInstallationStatus({}),
    staleTime: 30_000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: key });
  };

  const installMutation = useMutation<
    unknown,
    Error,
    { id: AgentProviderId; method?: InstallMethod }
  >({
    mutationKey: opKey('install', connectionId),
    mutationFn: async ({ id, method }) =>
      remoteUnavailable
        ? Promise.resolve(remoteDependencyUnavailableResult())
        : (await getDesktopWireClient()).agents.install({ id, method }),
    onSuccess: (result, vars) => {
      invalidate();
      const name = nameOf(vars.id);
      if ((result as { success: boolean }).success) {
        toast({ title: `${name} successfully installed` });
      } else {
        toast({ title: `Failed to install ${name}`, variant: 'destructive' });
      }
    },
    onError: (_, vars) => {
      toast({ title: `Failed to install ${nameOf(vars.id)}`, variant: 'destructive' });
    },
  });

  const updateMutation = useMutation<
    unknown,
    Error,
    { id: AgentProviderId; method?: InstallMethod }
  >({
    mutationKey: opKey('update', connectionId),
    mutationFn: async ({ id, method }) =>
      remoteUnavailable
        ? Promise.resolve(remoteDependencyUnavailableResult())
        : (await getDesktopWireClient()).agents.update({ id, method }),
    onSuccess: (result, vars) => {
      invalidate();
      const name = nameOf(vars.id);
      if ((result as { success: boolean }).success) {
        toast({ title: `${name} successfully updated` });
      } else {
        toast({ title: `Failed to update ${name}`, variant: 'destructive' });
      }
    },
    onError: (_, vars) => {
      toast({ title: `Failed to update ${nameOf(vars.id)}`, variant: 'destructive' });
    },
  });

  const uninstallMutation = useMutation<
    unknown,
    Error,
    { id: AgentProviderId; method?: InstallMethod }
  >({
    mutationKey: opKey('uninstall', connectionId),
    mutationFn: async ({ id, method }) =>
      remoteUnavailable
        ? Promise.resolve(remoteDependencyUnavailableResult())
        : (await getDesktopWireClient()).agents.uninstall({ id, method }),
    onSuccess: invalidate,
  });

  const setUsedMutation = useMutation<
    void,
    Error,
    { id: string; selection: HostDependencySelection }
  >({
    mutationFn: async ({ id, selection }) =>
      remoteUnavailable
        ? Promise.resolve()
        : (await getDesktopWireClient()).agents.setUsedInstallation({ id, selection }),
    onSuccess: invalidate,
  });

  const refreshLatestMutation = useMutation<void, Error, string>({
    mutationFn: async (id) =>
      remoteUnavailable
        ? Promise.resolve()
        : (await getDesktopWireClient()).agents.refreshLatestVersion({ id }),
    onSuccess: invalidate,
  });

  const probeAllMutation = useMutation<void, Error, void>({
    mutationFn: async () =>
      remoteUnavailable ? Promise.resolve() : (await getDesktopWireClient()).agents.probeAll({}),
    onSuccess: invalidate,
  });

  return {
    ...query,
    install: installMutation.mutate,
    update: updateMutation.mutate,
    uninstall: uninstallMutation.mutate,
    setUsedInstallation: setUsedMutation.mutate,
    refreshLatestVersion: refreshLatestMutation.mutate,
    probeAll: probeAllMutation.mutate,
    isInstalling: installMutation.isPending,
    isUpdating: updateMutation.isPending,
    isUninstalling: uninstallMutation.isPending,
    installingMethod: installMutation.isPending ? installMutation.variables?.method : undefined,
    updatingMethod: updateMutation.isPending ? updateMutation.variables?.method : undefined,
    uninstallingMethod: uninstallMutation.isPending
      ? uninstallMutation.variables?.method
      : undefined,
  };
}

/**
 * View-model type for a single agent's installation state. Consumed by the
 * install cards as the single source of truth (`vm`).
 */
export type HostDependencyInstallation = {
  /** The raw status DTO for this agent from the host probe, or null before the first probe. */
  data: AgentInstallationStatus | null;
  installations: Installation[];
  /** The authoritative source (persisted override or auto). */
  used: SelectedSource | undefined;
  /** Dependency status — 'available', 'missing', 'outdated', etc. (not the query status). */
  status: DependencyStatus;
  /** True while an install mutation is in flight for this host. */
  isInstalling: boolean;
  /** True while an update mutation is in flight for this host. */
  isUpdating: boolean;
  /** True while an uninstall mutation is in flight for this host. */
  isUninstalling: boolean;
  /** The install method currently being installed, if any. */
  installingMethod: InstallMethod | undefined;
  /** The install method currently being updated, if any. */
  updatingMethod: InstallMethod | undefined;
  /** The install method currently being uninstalled, if any. */
  uninstallingMethod: InstallMethod | undefined;
  install(method: InstallMethod): Promise<void>;
  update(method?: InstallMethod): Promise<void>;
  uninstall(method?: InstallMethod): Promise<void>;
  setUsed(selection: HostDependencySelection): Promise<void>;
  refresh(): Promise<void>;
  fetchLatestVersion(): Promise<void>;
  probeOverride(selection: { path?: string; cli?: string }): Promise<Installation | null>;
};

function remoteDependencyUnavailableResult() {
  return {
    success: false as const,
    error: {
      type: 'runtime-unavailable' as const,
      message: 'Remote host dependencies require the workspace server.',
    },
  };
}

/**
 * Returns the installation status and full per-agent view-model for a single
 * agent. `agentPayload` (optional) hydrates a synthetic installation before the
 * first probe completes so the UI can render immediately.
 */
export function useAgentInstallationStatus(
  id: string,
  connectionId?: string,
  agentPayload?: AgentPayload
): HostDependencyInstallation {
  const {
    data: statuses,
    install: installMutate,
    update: updateMutate,
    uninstall: uninstallMutate,
    setUsedInstallation,
    refreshLatestVersion,
    probeAll,
  } = useAgentInstallationStatuses(connectionId);

  // Derive per-agent pending state from the global MutationCache so it
  // survives the sheet being closed and reopened while the operation runs.
  const pendingInstalls = useMutationState({
    filters: { mutationKey: opKey('install', connectionId), status: 'pending' },
    select: selectOpVars,
  });
  const installVar = pendingInstalls.find((v) => v?.id === id);
  const isInstalling = !!installVar;
  const installingMethod = installVar?.method;

  const pendingUpdates = useMutationState({
    filters: { mutationKey: opKey('update', connectionId), status: 'pending' },
    select: selectOpVars,
  });
  const updateVar = pendingUpdates.find((v) => v?.id === id);
  const isUpdating = !!updateVar;
  const updatingMethod = updateVar?.method;

  const pendingUninstalls = useMutationState({
    filters: { mutationKey: opKey('uninstall', connectionId), status: 'pending' },
    select: selectOpVars,
  });
  const uninstallVar = pendingUninstalls.find((v) => v?.id === id);
  const isUninstalling = !!uninstallVar;
  const uninstallingMethod = uninstallVar?.method;

  const statusEntry = statuses?.find((s) => s.id === id) ?? null;

  const installations = useMemo<Installation[]>(() => {
    if (statusEntry) return statusEntry.installations;
    if (!agentPayload) return [];
    // Synthetic installation before the first probe completes
    const syntheticPath = agentPayload.command;
    return [
      {
        id: syntheticPath ?? 'auto',
        realpath: syntheticPath ?? 'auto',
        pathEntry: syntheticPath,
        isActive: true,
        manageable: false,
        provenance: { kind: 'unknown', confidence: 'inferred' } as const,
        status: agentPayload.status,
        version: agentPayload.version,
        latestVersion: agentPayload.latestVersion,
        updateAvailable: agentPayload.updateAvailable,
      },
    ];
  }, [statusEntry, agentPayload]);

  const used: SelectedSource | undefined = statusEntry?.used ?? agentPayload?.used;
  const status: DependencyStatus = statusEntry?.status ?? agentPayload?.status ?? 'missing';

  const install = useCallback(
    (method: InstallMethod) =>
      new Promise<void>((resolve) => {
        installMutate({ id: id as AgentProviderId, method }, { onSettled: () => resolve() });
      }),
    [installMutate, id]
  );

  const update = useCallback(
    (method?: InstallMethod) =>
      new Promise<void>((resolve) => {
        updateMutate({ id: id as AgentProviderId, method }, { onSettled: () => resolve() });
      }),
    [updateMutate, id]
  );

  const uninstall = useCallback(
    (method?: InstallMethod) =>
      new Promise<void>((resolve) => {
        uninstallMutate({ id: id as AgentProviderId, method }, { onSettled: () => resolve() });
      }),
    [uninstallMutate, id]
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

  const probeOverride = useCallback(
    async (selection: { path?: string; cli?: string }) =>
      connectionId
        ? Promise.resolve(null)
        : ((await getDesktopWireClient()).agents.probeOverride({
            id: id as AgentProviderId,
            selection,
          }) as Promise<Installation | null>),
    [id, connectionId]
  );

  return {
    data: statusEntry,
    installations,
    used,
    status,
    isInstalling,
    isUpdating,
    isUninstalling,
    installingMethod,
    updatingMethod,
    uninstallingMethod,
    install,
    update,
    uninstall,
    setUsed,
    refresh,
    fetchLatestVersion,
    probeOverride,
  };
}
