import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgentSettings } from '@core/primitives/agents/api';
import type { ProviderCustomConfig } from '@core/primitives/app-settings/api';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';

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
      const result = await (await getDesktopWireClient()).agents.getSettings({ id });
      return result;
    },
    staleTime: 60_000,
  });

  const updateMutation = useMutation<void, Error, Partial<ProviderCustomConfig>>({
    mutationFn: async (config) =>
      (await getDesktopWireClient()).agents.updateSettings({ id, config }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const resetMutation = useMutation<void, Error, void>({
    mutationFn: async () => {
      const defaults = await (await getDesktopWireClient()).agents.getDefaultSettings({ id });
      if (defaults) {
        await (await getDesktopWireClient()).agents.updateSettings({ id, config: defaults });
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
