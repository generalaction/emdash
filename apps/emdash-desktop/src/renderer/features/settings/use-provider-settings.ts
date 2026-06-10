import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@renderer/lib/ipc';
import type { AgentSettings } from '@shared/core/agents/agent-payload';
import type { ProviderCustomConfig } from '@shared/core/app-settings';

export function useProviderSettings(providerId: string) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<AgentSettings | null>({
    queryKey: ['agentSettings', providerId] as const,
    queryFn: async () => {
      // Pull the settings from the full agent payload returned by the controller.
      const payload = await (rpc.agents.get(providerId) as Promise<{ settings: AgentSettings } | null>);
      return payload?.settings ?? null;
    },
    staleTime: 60_000,
  });

  const updateMutation = useMutation<void, Error, Partial<ProviderCustomConfig>>({
    mutationFn: (config) => rpc.agents.updateSettings(providerId, config) as Promise<void>,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['agentSettings', providerId] });
    },
  });

  const resetMutation = useMutation<void, Error, void>({
    mutationFn: async () => {
      const defaults = await (rpc.agents.getDefaultSettings(providerId) as Promise<ProviderCustomConfig | null>);
      if (defaults) {
        await (rpc.agents.updateSettings(providerId, defaults) as Promise<void>);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['agentSettings', providerId] });
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
