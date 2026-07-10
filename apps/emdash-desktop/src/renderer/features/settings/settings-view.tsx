import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { SettingsPage } from '@renderer/features/settings/components/SettingsPage';
import type { SettingsPageTab } from '@renderer/features/settings/settings-tabs';
import { useParams } from '@renderer/lib/layout/navigation-provider';

const SettingsTabContext = createContext<{
  tab: SettingsPageTab;
  onTabChange: (tab: SettingsPageTab) => void;
} | null>(null);

/** Minimal passthrough — exists so the registry can infer WrapParams<'settings'>. */
export function SettingsViewWrapper({
  children,
  tab = 'general',
}: {
  children: ReactNode;
  tab?: SettingsPageTab;
}) {
  const { setParams } = useParams('settings');
  const handleTabChange = useCallback(
    (tab: SettingsPageTab) => {
      setParams({ tab });
    },
    [setParams]
  );
  return (
    <SettingsTabContext.Provider value={{ tab, onTabChange: handleTabChange }}>
      {children}
    </SettingsTabContext.Provider>
  );
}

export function useSettingsTab() {
  const context = useContext(SettingsTabContext);
  if (!context) {
    throw new Error('useSettingsTab must be used within a SettingsViewWrapper');
  }
  return context;
}

export function SettingsMainPanel() {
  const { tab, onTabChange } = useSettingsTab();
  return (
    <div className="relative z-10 flex min-h-0 flex-1 overflow-hidden bg-background">
      <SettingsPage tab={tab} onTabChange={onTabChange} />
    </div>
  );
}

export const settingsView = {
  WrapView: SettingsViewWrapper,
  MainPanel: SettingsMainPanel,
};
