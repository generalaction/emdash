import type { InstallMethod } from '@emdash/core/services/host-dependencies/api';
import { useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import type {
  InstallMachineSystemDependenciesResult,
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

const systemDependencyBatchInstallKey = (machineId: string | undefined) =>
  ['machines', machineId, 'system-dependencies', 'install-batch'] as const;

type InstallVariables = {
  id: string;
  method?: InstallMethod;
  elevate?: boolean;
};

type BatchInstallVariables = {
  dependencies: InstallVariables[];
};

const selectInstallVariables = (mutation: { state: { variables?: unknown } }) =>
  mutation.state.variables as InstallVariables | undefined;

const selectBatchInstallVariables = (mutation: { state: { variables?: unknown } }) =>
  mutation.state.variables as BatchInstallVariables | undefined;

export function useSystemDependencies(
  machineId: string | undefined,
  enabled: boolean,
  machinesStore: SystemDependenciesStore
) {
  const queryClient = useQueryClient();
  const failureMap = useDependencyOperationFailures();
  const queryKey = systemDependencyQueryKey(machineId);
  const installKey = systemDependencyInstallKey(machineId);
  const batchInstallKey = systemDependencyBatchInstallKey(machineId);

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

  const reportInstallResult = useCallback(
    (result: InstallMachineSystemDependencyResult, variables: InstallVariables) => {
      const name = nameOf(variables.id);
      if (result.success) {
        failureMap.clearFailure(variables.id);
        toast({ title: `${name} successfully installed` });
        return;
      }
      if (result.error.type === 'permission-denied') {
        failureMap.setFailure(variables.id, {
          error: result.error,
          method: variables.method,
        });
        toast({
          title: `Permission denied installing ${name}`,
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
    [failureMap, nameOf]
  );

  const installMutation = useMutation<
    InstallMachineSystemDependencyResult,
    Error,
    InstallVariables
  >({
    mutationKey: installKey,
    mutationFn: async ({ id, method, elevate }) => {
      const results = await machinesStore.installSystemDependencies({
        machineId,
        dependencies: [{ id, method, elevate }],
      });
      return (
        results[id] ?? {
          success: false,
          error: { type: 'io', message: `Install result missing for dependency: ${id}` },
        }
      );
    },
    onSuccess: (result, variables) => {
      invalidate();
      reportInstallResult(result, variables);
    },
    onError: (error, variables) => {
      toast({
        title: `Failed to install ${nameOf(variables.id)}`,
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const batchInstallMutation = useMutation<
    InstallMachineSystemDependenciesResult,
    Error,
    BatchInstallVariables
  >({
    mutationKey: batchInstallKey,
    mutationFn: async ({ dependencies }) =>
      await machinesStore.installSystemDependencies({ machineId, dependencies }),
    onSuccess: (results, variables) => {
      invalidate();
      for (const dependency of variables.dependencies) {
        const result = results[dependency.id];
        if (result) {
          reportInstallResult(result, dependency);
          continue;
        }
        failureMap.clearFailure(dependency.id);
        toast({
          title: `Failed to install ${nameOf(dependency.id)}`,
          description: 'The host did not return an install result.',
          variant: 'destructive',
        });
      }
    },
    onError: (error) => {
      toast({
        title: 'Failed to install system dependencies',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const pendingInstalls = useMutationState({
    filters: { mutationKey: installKey, status: 'pending' },
    select: selectInstallVariables,
  });
  const pendingBatchInstalls = useMutationState({
    filters: { mutationKey: batchInstallKey, status: 'pending' },
    select: selectBatchInstallVariables,
  });

  const installingIds = useMemo(() => {
    const ids = new Set<string>();
    for (const variables of pendingInstalls) {
      if (variables?.id) ids.add(variables.id);
    }
    for (const variables of pendingBatchInstalls) {
      for (const dependency of variables?.dependencies ?? []) ids.add(dependency.id);
    }
    return ids;
  }, [pendingBatchInstalls, pendingInstalls]);

  const install = useCallback(
    (id: string, method?: InstallMethod, elevate?: boolean) =>
      installMutation.mutateAsync({ id, method, elevate }),
    [installMutation]
  );

  const installAll = useCallback(
    async (dependencies: MachineSystemDependencyStatus[]) => {
      const requests = dependencies.flatMap((dependency) => {
        if (dependency.status === 'available' || dependency.installOptions.length === 0) return [];
        const option =
          dependency.installOptions.find((candidate) => candidate.recommended) ??
          dependency.installOptions[0];
        return [{ id: dependency.id, method: option?.method }];
      });
      if (requests.length === 0) return {};
      return await batchInstallMutation.mutateAsync({ dependencies: requests });
    },
    [batchInstallMutation]
  );

  return {
    ...query,
    refresh: query.refetch,
    install,
    installAll,
    installFailures: failureMap.failures,
    dismissInstallFailure: failureMap.clearFailure,
    installingIds,
    isInstalling: installMutation.isPending || batchInstallMutation.isPending,
  };
}
