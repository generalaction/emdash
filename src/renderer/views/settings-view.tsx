import { createContext, useContext, type ReactNode } from 'react';
import { SettingsPage, type SettingsPageTab } from '@renderer/components/SettingsPage';
import { Titlebar } from '@renderer/components/titlebar/Titlebar';

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
