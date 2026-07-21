import { hostRefKey, LOCAL_HOST_REF, type HostRef } from '@emdash/core/primitives/host/api';
import type { RuntimeResolveError } from '@emdash/core/services/runtime-broker/api';
import type { AgentProviderId } from '@emdash/plugins/agents';
import { useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { getAgentsClient, unwrapAgentsResult } from '@core/features/agents/api/browser/client';
import { useAgents } from '@core/features/agents/api/browser/use-agents';
import type {
  AgentInstallationStatus,
  AgentPayload,
  DependencyStatus,
  HostDependencySelection,
  Installation,
  InstallMethod,
  SelectedSource,
} from '@core/primitives/agents/api';
import { toast } from '@core/primitives/ui/browser/use-toast';

function statusQueryKey(host: HostRef) {
  return ['agents', 'status', hostRefKey(host)] as const;
}

function opKey(op: 'install' | 'update' | 'uninstall', host: HostRef) {
  return ['agents', op, hostRefKey(host)] as const;
}

type OpVars = { id: AgentProviderId; method?: InstallMethod };
const selectOpVars = (mutation: { state: { variables?: unknown } }) =>
  mutation.state.variables as OpVars | undefined;

export function useAgentInstallationStatuses(host: HostRef = LOCAL_HOST_REF) {
  const queryClient = useQueryClient();
  const key = statusQueryKey(host);
  const { data: agents } = useAgents(host);
  const agentNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const agent of agents ?? []) map.set(agent.id, agent.name);
    return map;
  }, [agents]);
  const nameOf = (id: string) => agentNameMap.get(id) ?? id;

  const query = useQuery<AgentInstallationStatus[], RuntimeResolveError>({
    queryKey: key,
    queryFn: async () =>
      unwrapAgentsResult((await getAgentsClient()).listAgentInstallationStatus({ host })),
    staleTime: 30_000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: key });
  };

  const installMutation = useMutation<
    unknown,
    RuntimeResolveError,
    { id: AgentProviderId; method?: InstallMethod }
  >({
    mutationKey: opKey('install', host),
    mutationFn: async ({ id, method }) =>
      unwrapAgentsResult((await getAgentsClient()).install({ host, id, method })),
    onSuccess: (result, variables) => {
      invalidate();
      const name = nameOf(variables.id);
      if ((result as { success: boolean }).success) {
        toast({ title: `${name} successfully installed` });
      } else {
        toast({ title: `Failed to install ${name}`, variant: 'destructive' });
      }
    },
    onError: (_, variables) => {
      toast({ title: `Failed to install ${nameOf(variables.id)}`, variant: 'destructive' });
    },
  });

  const updateMutation = useMutation<
    unknown,
    RuntimeResolveError,
    { id: AgentProviderId; method?: InstallMethod }
  >({
    mutationKey: opKey('update', host),
    mutationFn: async ({ id, method }) =>
      unwrapAgentsResult((await getAgentsClient()).update({ host, id, method })),
    onSuccess: (result, variables) => {
      invalidate();
      const name = nameOf(variables.id);
      if ((result as { success: boolean }).success) {
        toast({ title: `${name} successfully updated` });
      } else {
        toast({ title: `Failed to update ${name}`, variant: 'destructive' });
      }
    },
    onError: (_, variables) => {
      toast({ title: `Failed to update ${nameOf(variables.id)}`, variant: 'destructive' });
    },
  });

  const uninstallMutation = useMutation<
    unknown,
    RuntimeResolveError,
    { id: AgentProviderId; method?: InstallMethod }
  >({
    mutationKey: opKey('uninstall', host),
    mutationFn: async ({ id, method }) =>
      unwrapAgentsResult((await getAgentsClient()).uninstall({ host, id, method })),
    onSuccess: invalidate,
  });

  const setUsedMutation = useMutation<
    void,
    RuntimeResolveError,
    { id: string; selection: HostDependencySelection }
  >({
    mutationFn: async ({ id, selection }) =>
      unwrapAgentsResult((await getAgentsClient()).setUsedInstallation({ host, id, selection })),
    onSuccess: invalidate,
  });

  const refreshLatestMutation = useMutation<void, RuntimeResolveError, string>({
    mutationFn: async (id) =>
      unwrapAgentsResult((await getAgentsClient()).refreshLatestVersion({ host, id })),
    onSuccess: invalidate,
  });

  const probeAllMutation = useMutation<void, RuntimeResolveError, void>({
    mutationFn: async () => unwrapAgentsResult((await getAgentsClient()).probeAll({ host })),
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

export type HostDependencyInstallation = {
  runtimeError: RuntimeResolveError | null;
  data: AgentInstallationStatus | null;
  installations: Installation[];
  used: SelectedSource | undefined;
  status: DependencyStatus;
  isInstalling: boolean;
  isUpdating: boolean;
  isUninstalling: boolean;
  installingMethod: InstallMethod | undefined;
  updatingMethod: InstallMethod | undefined;
  uninstallingMethod: InstallMethod | undefined;
  install(method: InstallMethod): Promise<void>;
  update(method?: InstallMethod): Promise<void>;
  uninstall(method?: InstallMethod): Promise<void>;
  setUsed(selection: HostDependencySelection): Promise<void>;
  refresh(): Promise<void>;
  fetchLatestVersion(): Promise<void>;
  probeOverride(selection: { path?: string; cli?: string }): Promise<Installation | null>;
};

export function useAgentInstallationStatus(
  id: string,
  host: HostRef = LOCAL_HOST_REF,
  agentPayload?: AgentPayload
): HostDependencyInstallation {
  const {
    data: statuses,
    error: runtimeError,
    install: installMutate,
    update: updateMutate,
    uninstall: uninstallMutate,
    setUsedInstallation,
    refreshLatestVersion,
    probeAll,
  } = useAgentInstallationStatuses(host);

  const pendingInstalls = useMutationState({
    filters: { mutationKey: opKey('install', host), status: 'pending' },
    select: selectOpVars,
  });
  const installVariable = pendingInstalls.find((variable) => variable?.id === id);
  const isInstalling = !!installVariable;
  const installingMethod = installVariable?.method;

  const pendingUpdates = useMutationState({
    filters: { mutationKey: opKey('update', host), status: 'pending' },
    select: selectOpVars,
  });
  const updateVariable = pendingUpdates.find((variable) => variable?.id === id);
  const isUpdating = !!updateVariable;
  const updatingMethod = updateVariable?.method;

  const pendingUninstalls = useMutationState({
    filters: { mutationKey: opKey('uninstall', host), status: 'pending' },
    select: selectOpVars,
  });
  const uninstallVariable = pendingUninstalls.find((variable) => variable?.id === id);
  const isUninstalling = !!uninstallVariable;
  const uninstallingMethod = uninstallVariable?.method;

  const statusEntry = statuses?.find((status) => status.id === id) ?? null;
  const installations = useMemo<Installation[]>(() => {
    if (statusEntry) return statusEntry.installations;
    if (!agentPayload) return [];
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
      unwrapAgentsResult(
        (await getAgentsClient()).probeOverride({
          host,
          id: id as AgentProviderId,
          selection,
        })
      ),
    [host, id]
  );

  return {
    runtimeError,
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
