import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, ReactNode, useCallback, useContext } from 'react';
import type { AppSettings, AppSettingsKey } from '@shared/app-settings';
import { rpc } from '@renderer/lib/ipc';

// ---------------------------------------------------------------------------
// Per-key hook — the primary API for settings components.
// ---------------------------------------------------------------------------

type SettingsMeta<K extends AppSettingsKey> = {
  value: AppSettings[K];
  defaults: AppSettings[K];
  overrides: Partial<AppSettings[K]>;
};

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

export function useAppSettingsKey<K extends AppSettingsKey>(key: K) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<SettingsMeta<K>>({
    queryKey: ['appSettings', key, 'meta'] as const,
    queryFn: () => rpc.appSettings.getWithMeta(key) as Promise<SettingsMeta<K>>,
    staleTime: 60_000,
  });

  const updateMutation = useMutation<
    void,
    Error,
    Partial<AppSettings[K]>,
    { prev: SettingsMeta<K> | undefined }
  >({
    mutationFn: (partial) => {
      const current = queryClient.getQueryData<SettingsMeta<K>>(['appSettings', key, 'meta']);
      const merged = mergeValue(current?.value, partial);
      return rpc.appSettings.update(key, merged) as Promise<void>;
    },
    onMutate: async (partial) => {
      await queryClient.cancelQueries({ queryKey: ['appSettings', key, 'meta'] });
      const prev = queryClient.getQueryData<SettingsMeta<K>>(['appSettings', key, 'meta']);
      queryClient.setQueryData(['appSettings', key, 'meta'], (old: SettingsMeta<K> | undefined) =>
        old ? { ...old, value: mergeValue(old.value, partial) } : old
      );
      queryClient.setQueryData(['appSettings', 'all'], (all: AppSettings | undefined) =>
        all && prev ? ({ ...all, [key]: mergeValue(prev.value, partial) } as AppSettings) : all
      );
      return { prev };
    },
    onError: (_err, _partial, ctx) => {
      if (ctx?.prev !== undefined) {
        queryClient.setQueryData(['appSettings', key, 'meta'], ctx.prev);
      }
      queryClient.invalidateQueries({ queryKey: ['appSettings', 'all'] });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['appSettings', 'all'] });
    },
  });

  const resetMutation = useMutation<void, Error, void>({
    mutationFn: () => rpc.appSettings.reset(key) as Promise<void>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appSettings', key, 'meta'] });
      queryClient.invalidateQueries({ queryKey: ['appSettings', 'all'] });
    },
  });

  const resetFieldMutation = useMutation<void, Error, keyof AppSettings[K]>({
    mutationFn: (field) => rpc.appSettings.resetField(key, field as string) as Promise<void>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appSettings', key, 'meta'] });
      queryClient.invalidateQueries({ queryKey: ['appSettings', 'all'] });
    },
  });

  return {
    value: data?.value,
    defaults: data?.defaults,
    overrides: data?.overrides,
    isLoading,
    isSaving: updateMutation.isPending,
    isOverridden: !!(data?.overrides && Object.keys(data.overrides).length > 0),
    isFieldOverridden: (field: keyof AppSettings[K]) =>
      !!(data?.overrides && field in data.overrides),
    update: updateMutation.mutate,
    reset: resetMutation.mutate,
    resetField: (field: keyof AppSettings[K]) => resetFieldMutation.mutate(field),
  };
}

// ---------------------------------------------------------------------------
// Backward-compatible context for consumers using useAppSettings().
// Uses a single getAll query.
// ---------------------------------------------------------------------------

type AppSettingsUpdate = {
  [K in AppSettingsKey]: { key: K; value: Partial<AppSettings[K]> };
}[AppSettingsKey];

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
      const current = queryClient.getQueryData<AppSettings>(['appSettings', 'all']);
      const merged = mergeValue(current?.[key], value);
      return rpc.appSettings.update(key, merged);
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
