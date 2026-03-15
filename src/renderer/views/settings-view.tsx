import type { ReactNode } from 'react';
import { SettingsPage, type SettingsPageTab } from '@renderer/components/settings/SettingsPage';
import { Titlebar } from '@renderer/components/titlebar/Titlebar';
import { useViewParams } from '@renderer/contexts/WorkspaceNavigationContext';

/** Minimal passthrough — exists so the registry can infer WrapParams<'settings'>. */
export function SettingsViewWrapper({ children }: { children: ReactNode; tab?: SettingsPageTab }) {
  return <>{children}</>;
}

export function SettingsTitlebar() {
  return <Titlebar />;
}

export function SettingsMainPanel() {
  const { params } = useViewParams('settings');
  const tab = params.tab ?? 'general';
  return (
    <div className="relative z-10 flex min-h-0 flex-1 overflow-hidden bg-background">
      <SettingsPage tab={tab} />
    </div>
  );
}
