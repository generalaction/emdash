import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProviderCustomConfig } from '@shared/app-settings';
import { rpc } from '@renderer/lib/ipc';

type ProviderSettingsMeta = {
  value: ProviderCustomConfig;
  defaults: ProviderCustomConfig;
  overrides: Partial<ProviderCustomConfig>;
} | null;

export function useProviderSettings(providerId: string) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<ProviderSettingsMeta>({
    queryKey: ['providerSettings', providerId, 'meta'] as const,
    queryFn: () =>
      rpc.providerSettings.getItemWithMeta(providerId) as Promise<ProviderSettingsMeta>,
    staleTime: 60_000,
  });

  const updateMutation = useMutation<void, Error, Partial<ProviderCustomConfig>>({
    mutationFn: (config) => rpc.providerSettings.updateItem(providerId, config) as Promise<void>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['providerSettings', providerId, 'meta'] });
      queryClient.invalidateQueries({ queryKey: ['providerSettings', 'all'] });
    },
  });

  const resetMutation = useMutation<void, Error, void>({
    mutationFn: () => rpc.providerSettings.resetItem(providerId) as Promise<void>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['providerSettings', providerId, 'meta'] });
      queryClient.invalidateQueries({ queryKey: ['providerSettings', 'all'] });
    },
  });

  return {
    value: data?.value,
    defaults: data?.defaults,
    overrides: data?.overrides,
    isLoading,
    isSaving: updateMutation.isPending || resetMutation.isPending,
    isOverridden: !!(data?.overrides && Object.keys(data.overrides).length > 0),
    isFieldOverridden: (field: keyof ProviderCustomConfig) =>
      !!(data?.overrides && field in data.overrides),
    update: updateMutation.mutate,
    reset: resetMutation.mutate,
  };
}
