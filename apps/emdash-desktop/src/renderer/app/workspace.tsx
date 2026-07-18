import { LeftSidebar } from '@core/features/workbench/browser/sidebar/left-sidebar';
import { WindowScope } from '@core/features/workbench/browser/window-scope';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { BrowserShortcutForwarding, KeybindingDispatcherMount } from '@renderer/lib/keybindings';
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
    <WindowScope>
      <BrowserShortcutForwarding />
      <KeybindingDispatcherMount />
      <WorkspaceLayout
        leftSidebar={<LeftSidebar />}
        mainContent={
          <WrapView {...params}>
            <WorkspaceViewContent />
          </WrapView>
        }
      />
      <Toaster />
    </WindowScope>
  );
}

function WorkspaceViewContent() {
  const { TitlebarSlot, MainPanel } = useWorkspaceSlots();
  return <WorkspaceContentLayout titlebarSlot={<TitlebarSlot />} mainPanel={<MainPanel />} />;
}
