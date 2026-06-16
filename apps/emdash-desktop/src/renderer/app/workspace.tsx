import { LeftSidebar } from '@renderer/features/sidebar/left-sidebar';
import { CommandShortcutBinder } from '@renderer/lib/commands/command-shortcut-binder';
import { AppKeyboardShortcuts } from '@renderer/lib/components/app-keyboard-shortcuts';
import { MonacoKeyboardBridge } from '@renderer/lib/components/monaco-keyboard-bridge';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import {
  useWorkspaceSlots,
  useWorkspaceWrapParams,
} from '@renderer/lib/layout/navigation-provider';
import { WorkspaceContentLayout, WorkspaceLayout } from '@renderer/lib/layout/workspace-layout';
import { Toaster } from '@renderer/lib/ui/toaster';
import { COMPACT_TITLEBAR_HEIGHT } from '@shared/app-menu';
import { CompactMenuBar } from './compact-menu-bar';

const isWindows = navigator.platform.toUpperCase().includes('WIN');

export function Workspace() {
  useTheme();
  const { WrapView } = useWorkspaceSlots();
  const { wrapParams } = useWorkspaceWrapParams();

  return (
    <div className="flex h-screen flex-col">
      <AppKeyboardShortcuts />
      <CommandShortcutBinder />
      <MonacoKeyboardBridge />
      {isWindows && <CompactMenuBar />}
      <div
        className="flex-1 overflow-hidden"
        style={isWindows ? { paddingTop: COMPACT_TITLEBAR_HEIGHT } : undefined}
      >
        <WorkspaceLayout
          leftSidebar={<LeftSidebar />}
          mainContent={
            <WrapView {...wrapParams}>
              <WorkspaceViewContent />
            </WrapView>
          }
        />
      </div>
      <Toaster />
    </div>
  );
}

function WorkspaceViewContent() {
  const { TitlebarSlot, MainPanel } = useWorkspaceSlots();
  return <WorkspaceContentLayout titlebarSlot={<TitlebarSlot />} mainPanel={<MainPanel />} />;
}
