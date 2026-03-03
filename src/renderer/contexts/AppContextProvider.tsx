import { useQuery } from '@tanstack/react-query';
import { createContext, ReactNode, useContext } from 'react';

type AppContextValue = {
  platform?: string;
  appVersion?: string;
  electronVersion?: string;
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppContextProvider({ children }: { children: ReactNode }) {
  const { data: platform } = useQuery({
    queryKey: ['app:platform'],
    staleTime: 60_000,
    queryFn: () => window.electronAPI.getPlatform(),
    refetchOnWindowFocus: false,
  });

  const { data: appVersion } = useQuery({
    queryKey: ['app:version'],
    staleTime: 60_000,
    queryFn: () => window.electronAPI.getAppVersion(),
    refetchOnWindowFocus: false,
  });

  const { data: electronVersion } = useQuery({
    queryKey: ['app:electronVersion'],
    staleTime: 60_000,
    queryFn: () => window.electronAPI.getElectronVersion(),
    refetchOnWindowFocus: false,
  });

  return (
    <AppContext.Provider value={{ platform, appVersion, electronVersion }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('App Context must be used inside of an app context provider');
  }
  return ctx;
}
