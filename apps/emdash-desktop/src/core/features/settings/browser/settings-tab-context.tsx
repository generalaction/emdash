import { createContext, useContext, type ReactNode } from 'react';
import type { SettingsPageTab } from '@core/features/settings/contributions/views';

export interface SettingsTabContextValue {
  tab: SettingsPageTab;
  detail?: string;
  onTabChange: (tab: SettingsPageTab) => void;
  openDetail: (detailId: string) => void;
  closeDetail: () => void;
}

const SettingsTabContext = createContext<SettingsTabContextValue | null>(null);

export function SettingsTabProvider({
  value,
  children,
}: {
  value: SettingsTabContextValue;
  children: ReactNode;
}) {
  return <SettingsTabContext.Provider value={value}>{children}</SettingsTabContext.Provider>;
}

export function useSettingsTab(): SettingsTabContextValue {
  const context = useContext(SettingsTabContext);
  if (!context) throw new Error('useSettingsTab must be used within a SettingsTabProvider');
  return context;
}
