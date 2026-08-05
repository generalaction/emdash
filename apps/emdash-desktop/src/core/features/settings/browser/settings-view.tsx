import { useCallback, useLayoutEffect, type ReactNode } from 'react';
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
import { SettingsTabProvider, useSettingsTab } from './settings-tab-context';

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
      <SettingsTabProvider
        value={{ tab, detail, onTabChange: handleTabChange, openDetail, closeDetail }}
      >
        {children}
      </SettingsTabProvider>
    </ViewScopeInstanceProvider>
  );
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
