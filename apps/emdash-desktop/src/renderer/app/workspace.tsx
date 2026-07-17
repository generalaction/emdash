import { LeftSidebar } from '@core/features/workbench/browser/sidebar/left-sidebar';
import { CommandShortcutBinder } from '@renderer/lib/commands/command-shortcut-binder';
import { AppKeyboardShortcuts } from '@renderer/lib/components/app-keyboard-shortcuts';
import { BrowserAppShortcutEvents } from '@renderer/lib/components/browser-app-shortcut-events';
import { MonacoKeyboardBridge } from '@renderer/lib/components/monaco-keyboard-bridge';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import {
  useWorkspaceSlots,
  useWorkspaceViewParams,
} from '@renderer/lib/layout/navigation-provider';
import { WorkspaceContentLayout, WorkspaceLayout } from '@renderer/lib/layout/workspace-layout';
import { Toaster } from '@renderer/lib/ui/toaster';

export function Workspace() {
  useTheme();
  const { WrapView } = useWorkspaceSlots();
  const { params } = useWorkspaceViewParams();

  return (
    <>
      <AppKeyboardShortcuts />
      <BrowserAppShortcutEvents />
      <CommandShortcutBinder />
      <MonacoKeyboardBridge />
      <WorkspaceLayout
        leftSidebar={<LeftSidebar />}
        mainContent={
          <WrapView {...params}>
            <WorkspaceViewContent />
          </WrapView>
        }
      />
      <Toaster />
    </>
  );
}

function WorkspaceViewContent() {
  const { TitlebarSlot, MainPanel } = useWorkspaceSlots();
  return <WorkspaceContentLayout titlebarSlot={<TitlebarSlot />} mainPanel={<MainPanel />} />;
}
