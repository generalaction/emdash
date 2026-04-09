import { AppKeyboardShortcuts } from '@renderer/components/app-keyboard-shortcuts';
import { Toaster } from '@renderer/components/ui/toaster';
import { ModalRenderer } from '@renderer/core/modal/modal-renderer';
import { LeftSidebar } from '@renderer/core/sidebar/left-sidebar';
import {
  useViewLayoutOverride,
  useWorkspaceSlots,
  useWorkspaceWrapParams,
} from '@renderer/core/view/navigation-provider';
import { WorkspaceContentLayout, WorkspaceLayout } from '@renderer/core/view/workspace-layout';
import { useTheme } from '@renderer/hooks/useTheme';

export function Workspace() {
  useTheme();
  const { WrapView } = useWorkspaceSlots();
  const { wrapParams } = useWorkspaceWrapParams();
  return (
    <>
      <AppKeyboardShortcuts />
      <WorkspaceLayout
        leftSidebar={<LeftSidebar />}
        mainContent={
          <WrapView {...wrapParams}>
            <ModalRenderer />
            <WorkspaceViewContent />
          </WrapView>
        }
      />
      <Toaster />
    </>
  );
}

function WorkspaceViewContent() {
  const { TitlebarSlot, MainPanel, RightPanel } = useWorkspaceSlots();
  const { hideRightPanel } = useViewLayoutOverride();
  const EffectiveRightPanel = hideRightPanel ? null : RightPanel;
  return (
    <WorkspaceContentLayout
      titlebarSlot={<TitlebarSlot />}
      mainPanel={<MainPanel />}
      rightPanel={EffectiveRightPanel ? <EffectiveRightPanel /> : null}
    />
  );
}
