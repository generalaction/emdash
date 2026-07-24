import { createContext, useCallback, useContext, useLayoutEffect, type ReactNode } from 'react';
import { SettingsPage } from '@core/features/settings/browser/components/SettingsPage';
import { settingsScope } from '@core/features/settings/contributions/scopes';
import { settingsViewDef, type SettingsPageTab } from '@core/features/settings/contributions/views';
import { Titlebar } from '@core/primitives/ui/browser/components/titlebar/Titlebar';
import type { ViewScopeImpl } from '@core/primitives/view-scopes/api';
import { scopes } from '@core/primitives/view-scopes/browser';
import { useViewScope, ViewScopeInstanceProvider } from '@core/primitives/view-scopes/react';
import { defineViewRuntime } from '@core/primitives/views/react';
import { useCurrentViewParams } from '@renderer/lib/layout/navigation-provider';
import { appState } from '@renderer/lib/stores/app-state';

interface SettingsTabContextValue {
  tab: SettingsPageTab;
  detail?: string;
  onTabChange: (tab: SettingsPageTab) => void;
  openDetail: (detailId: string) => void;
  closeDetail: () => void;
}

const SettingsTabContext = createContext<SettingsTabContextValue | null>(null);

export function SettingsViewWrapper({
  children,
  tab = 'general',
  detail,
}: {
  children: ReactNode;
  tab?: SettingsPageTab;
  detail?: string;
}) {
  const { setParams } = useCurrentViewParams(settingsViewDef);
  const handleTabChange = useCallback(
    (tab: SettingsPageTab) => {
      setParams({ tab, detail: undefined });
    },
    [setParams]
  );
  const openDetail = useCallback(
    (detailId: string) => {
      setParams({ detail: detailId });
    },
    [setParams]
  );
  const closeDetail = useCallback(() => {
    setParams({ detail: undefined });
  }, [setParams]);
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
      <SettingsTabContext.Provider
        value={{ tab, detail, onTabChange: handleTabChange, openDetail, closeDetail }}
      >
        {children}
      </SettingsTabContext.Provider>
    </ViewScopeInstanceProvider>
  );
}

export function useSettingsTab() {
  const context = useContext(SettingsTabContext);
  if (!context) {
    throw new Error('useSettingsTab must be used within a SettingsViewWrapper');
  }
  return context;
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
  const { tab, detail, onTabChange, openDetail, closeDetail } = useSettingsTab();
  return (
    <div className="relative z-10 flex min-h-0 flex-1 overflow-hidden bg-background">
      <SettingsPage
        tab={tab}
        detail={detail}
        onTabChange={onTabChange}
        openDetail={openDetail}
        closeDetail={closeDetail}
      />
    </div>
  );
}

export const settingsViewRuntime = defineViewRuntime(settingsViewDef, {
  slots: {
    wrap: SettingsViewWrapper,
    main: SettingsMainPanel,
  },
});
