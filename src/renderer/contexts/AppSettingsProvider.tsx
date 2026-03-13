import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, ReactNode, useCallback, useContext } from 'react';
import { AppSettings, AppSettingsKey } from '@shared/app-settings';
import { rpc } from '@renderer/lib/ipc';

interface AppSettingsContextValue {
  settings: AppSettings | undefined;
  isLoading: boolean;
  isSaving: boolean;
  updateSettings: (update: AppSettingsUpdate) => void;
}

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null);

type AppSettingsUpdate = {
  [K in AppSettingsKey]: { key: K; value: AppSettings[K] };
}[AppSettingsKey];

function applyUpdate<K extends AppSettingsKey>(
  settings: AppSettings,
  key: K,
  value: AppSettings[K]
): AppSettings {
  return { ...settings, [key]: value };
}

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['appSettings'],
    queryFn: () => rpc.appSettings.getAll(),
    staleTime: 60_000,
  });

  const updateSettingsMutation = useMutation({
    mutationFn: ({ key, value }: AppSettingsUpdate) => rpc.appSettings.update(key, value),
    onMutate: (update) => {
      const previousSettings = queryClient.getQueryData<AppSettings>(['appSettings']);
      queryClient.setQueryData(['appSettings'], (old: AppSettings) =>
        applyUpdate(old, update.key, update.value)
      );
      return { previousSettings };
    },
    onError: (_error, _update, context) => {
      queryClient.setQueryData(['appSettings'], context?.previousSettings);
    },
  });

  const isSaving = updateSettingsMutation.isPending;

  const updateSettings = useCallback(
    (settings: AppSettingsUpdate) => {
      updateSettingsMutation.mutate(settings);
    },
    [updateSettingsMutation]
  );

  return (
    <AppSettingsContext.Provider value={{ settings, isLoading, isSaving, updateSettings }}>
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
