import { observer } from 'mobx-react-lite';
import { Fragment, type ComponentType, type ReactNode } from 'react';
import { views, type ViewDefinition, type ViewId } from '@renderer/app/view-registry';
import { LeftSidebar } from '@renderer/features/sidebar/left-sidebar';
import { CommandShortcutBinder } from '@renderer/lib/commands/command-shortcut-binder';
import { AppKeyboardShortcuts } from '@renderer/lib/components/app-keyboard-shortcuts';
import { MonacoKeyboardBridge } from '@renderer/lib/components/monaco-keyboard-bridge';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { WorkspaceContentLayout, WorkspaceLayout } from '@renderer/lib/layout/workspace-layout';
import { appState } from '@renderer/lib/stores/app-state';
import { Toaster } from '@renderer/lib/ui/toaster';

type AnyViewDefinition = ViewDefinition<Record<string, unknown>>;

function NoOpTitlebar() {
  return null;
}

function resolveView(viewId: ViewId): AnyViewDefinition {
  return (views[viewId] ?? views.home) as AnyViewDefinition;
}

function resolveViewParams(viewId: ViewId): Record<string, unknown> {
  return (appState.navigation.viewParamsStore[viewId] ?? {}) as Record<string, unknown>;
}

function resolveWrapView(
  view: AnyViewDefinition
): ComponentType<{ children: ReactNode } & Record<string, unknown>> {
  return (view.WrapView ?? Fragment) as ComponentType<
    { children: ReactNode } & Record<string, unknown>
  >;
}

function ViewContent({ view }: { view: AnyViewDefinition }) {
  const TitlebarSlot = view.TitlebarSlot ?? NoOpTitlebar;
  const MainPanel = view.MainPanel;
  return <WorkspaceContentLayout titlebarSlot={<TitlebarSlot />} mainPanel={<MainPanel />} />;
}

export const Workspace = observer(function Workspace() {
  useTheme();

  const currentViewId = appState.navigation.currentViewId;
  const baseViewId =
    currentViewId === 'settings' ? appState.navigation.lastNonSettingsView : currentViewId;
  const baseView = resolveView(baseViewId);
  const BaseWrapView = resolveWrapView(baseView);
  const baseWrapParams = resolveViewParams(baseViewId);
  const isSettingsOpen = currentViewId === 'settings';
  const settingsView = isSettingsOpen ? resolveView('settings') : null;
  const SettingsWrapView = settingsView ? resolveWrapView(settingsView) : null;
  const settingsWrapParams = settingsView ? resolveViewParams('settings') : null;

  return (
    <>
      <AppKeyboardShortcuts />
      <CommandShortcutBinder />
      <MonacoKeyboardBridge />
      <WorkspaceLayout
        leftSidebar={<LeftSidebar />}
        mainContent={
          <div className="relative h-full overflow-hidden">
            <BaseWrapView {...baseWrapParams}>
              <ViewContent view={baseView} />
            </BaseWrapView>
            {settingsView && SettingsWrapView && settingsWrapParams ? (
              <div className="absolute inset-0 z-10 bg-background">
                <SettingsWrapView {...settingsWrapParams}>
                  <ViewContent view={settingsView} />
                </SettingsWrapView>
              </div>
            ) : null}
          </div>
        }
      />
      <Toaster />
    </>
  );
});
