import { rpc } from '@/lib/rpc';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, ReactNode, useCallback, useContext } from 'react';
import { AppSettings, AppSettingsUpdate } from 'src/main/settings';

interface AppSettingsContextValue {
  settings: AppSettings | undefined;
  isLoading: boolean;
  isSaving: boolean;
  updateSettings: (settings: AppSettingsUpdate) => void;
}

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null);

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['appSettings'],
    queryFn: () => rpc.appSettings.get(),
  });

  const updateSettingsMutation = useMutation({
    mutationFn: (update: AppSettingsUpdate) => rpc.appSettings.update(update),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appSettings'] });
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
