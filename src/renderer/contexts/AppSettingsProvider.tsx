import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, ReactNode, useCallback, useContext } from 'react';
import type { AppSettings, AppSettingsKey } from '@shared/app-settings';
import { rpc } from '@renderer/lib/ipc';

// ---------------------------------------------------------------------------
// Merge helper — works for both object keys and primitive keys (theme, defaultAgent).
// ---------------------------------------------------------------------------

function mergeValue<K extends AppSettingsKey>(
  current: AppSettings[K] | undefined,
  partial: Partial<AppSettings[K]>
): AppSettings[K] {
  if (
    typeof partial === 'object' &&
    partial !== null &&
    typeof current === 'object' &&
    current !== null
  ) {
    return { ...current, ...partial } as AppSettings[K];
  }
  return partial as AppSettings[K];
}

// ---------------------------------------------------------------------------
// Per-key hook — the primary API for settings/ components.
// After a mutation, also invalidates the assembled 'all' cache so
// consumers of useAppSettings() see the update on next render.
// ---------------------------------------------------------------------------

export function useAppSettingsKey<K extends AppSettingsKey>(key: K) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<AppSettings[K]>({
    queryKey: ['appSettings', key] as const,
    queryFn: () => rpc.appSettings.get(key) as Promise<AppSettings[K]>,
    staleTime: 60_000,
  });

  const mutation = useMutation<
    void,
    Error,
    Partial<AppSettings[K]>,
    { prev: AppSettings[K] | undefined }
  >({
    mutationFn: (partial) => {
      const current = queryClient.getQueryData<AppSettings[K]>(['appSettings', key]);
      // providerConfigs is excluded from the generic update; writes go through updateProviderConfig.
      return rpc.appSettings.update(
        key as Exclude<K, 'providerConfigs'>,
        mergeValue(current, partial) as AppSettings[Exclude<K, 'providerConfigs'>]
      ) as Promise<void>;
    },
    onMutate: async (partial) => {
      await queryClient.cancelQueries({ queryKey: ['appSettings', key] });
      const prev = queryClient.getQueryData<AppSettings[K]>(['appSettings', key]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      queryClient.setQueryData(['appSettings', key], (old: any) =>
        mergeValue(old as AppSettings[K], partial)
      );
      // Optimistically patch the assembled 'all' cache as well.
      queryClient.setQueryData(['appSettings', 'all'], (all: AppSettings | undefined) =>
        all ? ({ ...all, [key]: mergeValue(all[key as K], partial) } as AppSettings) : all
      );
      return { prev };
    },
    onError: (_err, _partial, ctx) => {
      if (ctx?.prev !== undefined) {
        queryClient.setQueryData(['appSettings', key], ctx.prev);
      }
      queryClient.invalidateQueries({ queryKey: ['appSettings', 'all'] });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['appSettings', 'all'] });
    },
  });

  return {
    value: data,
    isLoading,
    isSaving: mutation.isPending,
    update: mutation.mutate,
  };
}

// ---------------------------------------------------------------------------
// Backward-compatible context — out-of-scope consumers that still call
// useAppSettings(). Uses a single getAll query instead of 12 separate ones.
// ---------------------------------------------------------------------------

type AppSettingsUpdate = {
  [K in Exclude<AppSettingsKey, 'providerConfigs'>]: { key: K; value: Partial<AppSettings[K]> };
}[Exclude<AppSettingsKey, 'providerConfigs'>];

interface AppSettingsContextValue {
  settings: AppSettings | undefined;
  isLoading: boolean;
  isSaving: boolean;
  updateSettings: (update: AppSettingsUpdate) => void;
}

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null);

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery<AppSettings>({
    queryKey: ['appSettings', 'all'] as const,
    queryFn: () => rpc.appSettings.getAll() as Promise<AppSettings>,
    staleTime: 60_000,
  });

  const updateMutation = useMutation({
    mutationFn: ({ key, value }: AppSettingsUpdate) => {
      const current = queryClient.getQueryData<AppSettings[typeof key]>(['appSettings', key]);
      return rpc.appSettings.update(key, mergeValue(current, value));
    },
    onMutate: ({ key, value }) => {
      const prev = queryClient.getQueryData(['appSettings', 'all']);
      queryClient.setQueryData(['appSettings', 'all'], (old: AppSettings | undefined) =>
        old ? ({ ...old, [key]: mergeValue(old[key as typeof key], value) } as AppSettings) : old
      );
      return { prev };
    },
    onError: (_err, _update, ctx) => {
      if (ctx) queryClient.setQueryData(['appSettings', 'all'], ctx.prev);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['appSettings', 'all'] });
    },
  });

  const updateSettings = useCallback(
    (update: AppSettingsUpdate) => updateMutation.mutate(update),
    [updateMutation]
  );

  return (
    <AppSettingsContext.Provider
      value={{ settings, isLoading, isSaving: updateMutation.isPending, updateSettings }}
    >
      {children}
    </AppSettingsContext.Provider>
  );
}

export function useAppSettings() {
  const context = useContext(AppSettingsContext);
  if (!context) {
    throw new Error('useAppSettings must be used within an AppSettingsProvider');
  }
  return context;
}
