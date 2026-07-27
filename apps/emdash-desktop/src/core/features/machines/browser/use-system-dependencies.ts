import type {
  HostDependencyError,
  InstallMethod,
} from '@emdash/core/services/host-dependencies/api';
import { useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import type {
  InstallMachineSystemDependencyResult,
  MachineSystemDependencyStatus,
} from '@core/features/machines/api';
import { toast } from '@core/primitives/ui/browser/use-toast';
import type { SystemDependenciesStore } from './machines-store';

const systemDependencyQueryKey = (machineId: string | undefined) =>
  ['machines', machineId, 'system-dependencies'] as const;

const systemDependencyInstallKey = (machineId: string | undefined) =>
  ['machines', machineId, 'system-dependencies', 'install'] as const;

type InstallVariables = {
  id: string;
  method?: InstallMethod;
};

const selectInstallVariables = (mutation: { state: { variables?: unknown } }) =>
  mutation.state.variables as InstallVariables | undefined;

export function useSystemDependencies(
  machineId: string | undefined,
  enabled: boolean,
  machinesStore: SystemDependenciesStore
) {
  const queryClient = useQueryClient();
  const queryKey = systemDependencyQueryKey(machineId);
  const installKey = systemDependencyInstallKey(machineId);

  const query = useQuery<MachineSystemDependencyStatus[]>({
    queryKey,
    enabled,
    staleTime: 30_000,
    queryFn: async () => await machinesStore.getSystemDependencies(machineId),
  });

  const nameById = useMemo(() => {
    const names = new Map<string, string>();
    for (const dependency of query.data ?? []) names.set(dependency.id, dependency.name);
    return names;
  }, [query.data]);

  const nameOf = useCallback((id: string) => nameById.get(id) ?? id, [nameById]);

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);

  const installMutation = useMutation<
    InstallMachineSystemDependencyResult,
    Error,
    InstallVariables
  >({
    mutationKey: installKey,
    mutationFn: async ({ id, method }) =>
      await machinesStore.installSystemDependency({
        machineId,
        id,
        method,
      }),
    onSuccess: (result, variables) => {
      invalidate();
      const name = nameOf(variables.id);
      if (result.success) {
        toast({ title: `${name} successfully installed` });
        return;
      }
      toast({
        title: `Failed to install ${name}`,
        description: getHostDependencyErrorMessage(result.error),
        variant: 'destructive',
      });
    },
    onError: (error, variables) => {
      toast({
        title: `Failed to install ${nameOf(variables.id)}`,
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const pendingInstalls = useMutationState({
    filters: { mutationKey: installKey, status: 'pending' },
    select: selectInstallVariables,
  });

  const installingIds = useMemo(() => {
    const ids = new Set<string>();
    for (const variables of pendingInstalls) {
      if (variables?.id) ids.add(variables.id);
    }
    return ids;
  }, [pendingInstalls]);

  const install = useCallback(
    (id: string, method?: InstallMethod) => installMutation.mutateAsync({ id, method }),
    [installMutation]
  );

  const installAll = useCallback(
    async (dependencies: MachineSystemDependencyStatus[]) => {
      for (const dependency of dependencies) {
        if (dependency.status === 'available' || dependency.installOptions.length === 0) continue;
        const option =
          dependency.installOptions.find((candidate) => candidate.recommended) ??
          dependency.installOptions[0];
        await installMutation.mutateAsync({ id: dependency.id, method: option?.method });
      }
    },
    [installMutation]
  );

  return {
    ...query,
    refresh: query.refetch,
    install,
    installAll,
    installingIds,
    isInstalling: installMutation.isPending,
  };
}

export function getHostDependencyErrorMessage(error: HostDependencyError): string {
  switch (error.type) {
    case 'unknown-dependency':
      return `Unknown dependency: ${error.id}`;
    case 'missing':
      return `Dependency is missing: ${error.id}`;
    case 'stale-selection':
      return `Selected path no longer exists: ${error.path}`;
    case 'invalid-selection':
      return error.message;
    case 'no-install-command':
      return `No install command is available for ${error.id}.`;
    case 'not-detected-after-install':
      return `Installed ${error.id}, but the binary was not detected on PATH.`;
    case 'no-update-command':
      return `No update command is available for ${error.id}.`;
    case 'installer-missing':
      return `Installer is missing: ${error.tool}.`;
    case 'command-failed':
      return error.message;
    case 'io':
      return error.message;
  }
}
