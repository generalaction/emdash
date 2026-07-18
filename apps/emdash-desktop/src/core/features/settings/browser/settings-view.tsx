import { createContext, useCallback, useContext, useLayoutEffect, type ReactNode } from 'react';
import { SettingsPage } from '@core/features/settings/browser/components/SettingsPage';
import { settingsScope } from '@core/features/settings/contributions/scopes';
import { settingsViewDef, type SettingsPageTab } from '@core/features/settings/contributions/views';
import type { ViewScopeImpl } from '@core/primitives/view-scopes/api';
import { scopes } from '@core/primitives/view-scopes/browser';
import { useViewScope, ViewScopeInstanceProvider } from '@core/primitives/view-scopes/react';
import { defineViewRuntime } from '@core/primitives/views/react';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { useCurrentViewParams } from '@renderer/lib/layout/navigation-provider';
import { appState } from '@renderer/lib/stores/app-state';

const SettingsTabContext = createContext<{
  tab: SettingsPageTab;
  onTabChange: (tab: SettingsPageTab) => void;
}>({ tab: 'general', onTabChange: () => {} });

export function SettingsViewWrapper({
  children,
  tab = 'general',
}: {
  children: ReactNode;
  tab?: SettingsPageTab;
}) {
  const { setParams } = useCurrentViewParams(settingsViewDef);
  const handleTabChange = useCallback(
    (tab: SettingsPageTab) => {
      setParams({ tab });
    },
    [setParams]
  );
  const implementation = {
    'settings.close': () => ({
      execute: () => appState.navigation.toggleSettings(),
    }),
  } satisfies ViewScopeImpl<typeof settingsScope>;
  const { instance } = useViewScope(settingsScope(), implementation);

  useLayoutEffect(() => {
    if (instance) scopes.activate(instance);
  }, [instance]);

  if (!instance) return null;
  return (
    <ViewScopeInstanceProvider instance={instance}>
      <SettingsTabContext.Provider value={{ tab, onTabChange: handleTabChange }}>
        {children}
      </SettingsTabContext.Provider>
    </ViewScopeInstanceProvider>
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
  const { tab, onTabChange } = useSettingsTab();
  return (
    <div className="relative z-10 flex min-h-0 flex-1 overflow-hidden bg-background">
      <SettingsPage tab={tab} onTabChange={onTabChange} />
    </div>
  );
}

export const settingsViewRuntime = defineViewRuntime(settingsViewDef, {
  slots: {
    wrap: SettingsViewWrapper,
    main: SettingsMainPanel,
  },
});
