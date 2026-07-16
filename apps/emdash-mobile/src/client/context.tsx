import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { ConnectionStatus, MobileClient } from './types';

const MobileClientContext = createContext<MobileClient | null>(null);

export function MobileClientProvider({
  client,
  children,
}: {
  client: MobileClient;
  children: ReactNode;
}) {
  return <MobileClientContext.Provider value={client}>{children}</MobileClientContext.Provider>;
}

export function useMobileClient(): MobileClient {
  const client = useContext(MobileClientContext);
  if (!client) throw new Error('useMobileClient must be used inside MobileClientProvider');
  return client;
}

export function useConnectionStatus(): ConnectionStatus {
  const client = useMobileClient();
  return useSyncExternalStore(
    (listener) => client.subscribeConnection(listener),
    () => client.connectionStatus,
    () => 'offline'
  );
}
