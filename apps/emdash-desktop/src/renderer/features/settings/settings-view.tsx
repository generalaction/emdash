import { createContext, useCallback, useContext, type ReactNode } from 'react';
import {
  SettingsPage,
  type SettingsPageTargetParams,
  type SettingsPageTab,
} from '@renderer/features/settings/components/SettingsPage';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { useParams } from '@renderer/lib/layout/navigation-provider';
import type { SettingsSearchResult } from './settings-search-index';

const SettingsTabContext = createContext<
  {
    tab: SettingsPageTab;
    onTabChange: (tab: SettingsPageTab) => void;
  } & SettingsPageTargetParams
>({ tab: 'general', onTabChange: () => {} });

/** Minimal passthrough — exists so the registry can infer WrapParams<'settings'>. */
export function SettingsViewWrapper({
  children,
  tab = 'general',
  target,
  highlightNonce,
}: {
  children: ReactNode;
  tab?: SettingsPageTab;
} & SettingsPageTargetParams) {
  const { setParams } = useParams('settings');
  const handleTabChange = useCallback(
    (tab: SettingsPageTab) => {
      setParams({ tab, target: undefined, highlightNonce: undefined });
    },
    [setParams]
  );
  return (
    <SettingsTabContext.Provider
      value={{ tab, onTabChange: handleTabChange, target, highlightNonce }}
    >
      {children}
    </SettingsTabContext.Provider>
  );
}

export function useSettingsTab() {
  if (!useContext(SettingsTabContext)) {
    throw new Error('useSettingsTab must be used within a SettingsViewWrapper');
  }
  return useContext(SettingsTabContext);
}

export function SettingsTitlebar() {
  return (
    <Titlebar
      leftSlot={
        <div className="flex items-center px-2">
          <span className="text-sm text-foreground-muted">Settings</span>
        </div>
      }
    />
  );
}

export function SettingsMainPanel() {
  const { tab, onTabChange, target, highlightNonce } = useSettingsTab();
  const { setParams } = useParams('settings');
  const handleTargetSelect = useCallback(
    (result: SettingsSearchResult) => {
      setParams({
        tab: result.tab,
        target: result.id,
        highlightNonce: Date.now(),
      });
    },
    [setParams]
  );
  return (
    <div className="relative z-10 flex min-h-0 flex-1 overflow-hidden bg-background">
      <SettingsPage
        tab={tab}
        target={target}
        highlightNonce={highlightNonce}
        onTabChange={onTabChange}
        onTargetSelect={handleTargetSelect}
      />
    </div>
  );
}

export const settingsView = {
  WrapView: SettingsViewWrapper,
  MainPanel: SettingsMainPanel,
};
