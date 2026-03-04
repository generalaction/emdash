import { createContext, useContext, type ReactNode } from 'react';
import { Titlebar } from '@/components/titlebar/Titlebar';
import { SettingsPage, type SettingsPageTab } from '@/components/SettingsPage';

const SettingsTabContext = createContext<SettingsPageTab>('general');

export function useSettingsTab(): SettingsPageTab {
  return useContext(SettingsTabContext);
}

interface SettingsViewWrapperProps {
  children: ReactNode;
  tab?: SettingsPageTab;
}

export function SettingsViewWrapper({ children, tab = 'general' }: SettingsViewWrapperProps) {
  return <SettingsTabContext.Provider value={tab}>{children}</SettingsTabContext.Provider>;
}

export function SettingsTitlebar() {
  return <Titlebar />;
}

export function SettingsMainPanel() {
  const tab = useSettingsTab();
  return (
    <div className="relative z-10 flex min-h-0 flex-1 overflow-hidden bg-background">
      <SettingsPage initialTab={tab} />
    </div>
  );
}
