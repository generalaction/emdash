import type { InstallMethod } from '@emdash/core/services/host-dependencies/api';
import { useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import type {
  InstallMachineSystemDependencyResult,
  MachineSystemDependencyStatus,
} from '@core/features/machines/api';
import { getHostDependencyErrorMessage } from '@core/primitives/host-dependencies/browser/error-message';
import { useDependencyOperationFailures } from '@core/primitives/host-dependencies/browser/use-dependency-operation-failures';
import { toast } from '@core/primitives/ui/browser/use-toast';
import type { SystemDependenciesStore } from './machines-store';

const systemDependencyQueryKey = (machineId: string | undefined) =>
  ['machines', machineId, 'system-dependencies'] as const;

const systemDependencyInstallKey = (machineId: string | undefined) =>
  ['machines', machineId, 'system-dependencies', 'install'] as const;

type InstallVariables = {
  id: string;
  method?: InstallMethod;
  elevate?: boolean;
};

const selectInstallVariables = (mutation: { state: { variables?: unknown } }) =>
  mutation.state.variables as InstallVariables | undefined;

export function useSystemDependencies(
  machineId: string | undefined,
  enabled: boolean,
  machinesStore: SystemDependenciesStore
) {
  const queryClient = useQueryClient();
  const failureMap = useDependencyOperationFailures();
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
    mutationFn: async ({ id, method, elevate }) =>
      await machinesStore.installSystemDependency({
        machineId,
        id,
        method,
        elevate,
      }),
    onSuccess: (result, variables) => {
      invalidate();
      const name = nameOf(variables.id);
      if (result.success) {
        failureMap.clearFailure(variables.id);
        toast({ title: `${name} successfully installed` });
        return;
      }
      if (result.error.type === 'permission-denied') {
        const permissionError = result.error;
        failureMap.setFailure(variables.id, {
          error: permissionError,
          method: variables.method,
        });
        toast({
          title: 'Permission denied',
          description: 'See the install panel for retry and recovery options.',
        });
        return;
      }
      failureMap.clearFailure(variables.id);
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
    (id: string, method?: InstallMethod, elevate?: boolean) =>
      installMutation.mutateAsync({ id, method, elevate }),
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
    installFailures: failureMap.failures,
    dismissInstallFailure: failureMap.clearFailure,
    installingIds,
    isInstalling: installMutation.isPending,
  };
}
