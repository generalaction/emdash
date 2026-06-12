import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@renderer/lib/ipc';
import type { AgentSettings } from '@shared/core/agents/agent-payload';
import type { ProviderCustomConfig } from '@shared/core/app-settings';

function agentSettingsQueryKey(id: string) {
  return ['agents', 'settings', id] as const;
}

/**
 * Manages settings for a single agent: current value, defaults, mutations for
 * update and reset-to-defaults.
 *
 * Replaces `use-provider-settings.ts`.
 */
export function useAgentSettings(id: string) {
  const queryClient = useQueryClient();
  const queryKey = agentSettingsQueryKey(id);

  const query = useQuery<AgentSettings | null>({
    queryKey,
    queryFn: async () => {
      const result = await (rpc.agents.getSettings(id) as Promise<AgentSettings | null>);
      return result;
    },
    staleTime: 60_000,
  });

  const updateMutation = useMutation<void, Error, Partial<ProviderCustomConfig>>({
    mutationFn: (config) => rpc.agents.updateSettings(id, config) as Promise<void>,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const resetMutation = useMutation<void, Error, void>({
    mutationFn: async () => {
      const defaults = await (rpc.agents.getDefaultSettings(
        id
      ) as Promise<ProviderCustomConfig | null>);
      if (defaults) {
        await (rpc.agents.updateSettings(id, defaults) as Promise<void>);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const { data } = query;
  return {
    ...query,
    value: data?.value,
    defaults: data?.defaults,
    overrides: data?.overrides,
    isSaving: updateMutation.isPending || resetMutation.isPending,
    isOverridden: !!(data?.overrides && Object.keys(data.overrides).length > 0),
    isFieldOverridden: (field: keyof ProviderCustomConfig) =>
      !!(data?.overrides && field in data.overrides),
    update: updateMutation.mutate,
    updateAsync: updateMutation.mutateAsync,
    reset: resetMutation.mutate,
  };
}
