import { LeftSidebar } from '@renderer/features/sidebar/left-sidebar';
import { AppKeyboardShortcuts } from '@renderer/lib/components/app-keyboard-shortcuts';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { useTrackpadHistorySwipe } from '@renderer/lib/hooks/useTrackpadHistorySwipe';
import {
  useViewLayoutOverride,
  useWorkspaceSlots,
  useWorkspaceWrapParams,
} from '@renderer/lib/layout/navigation-provider';
import { WorkspaceContentLayout, WorkspaceLayout } from '@renderer/lib/layout/workspace-layout';
import { ModalRenderer } from '@renderer/lib/modal/modal-renderer';
import { Toaster } from '@renderer/lib/ui/toaster';

export function Workspace() {
  useTheme();
  useTrackpadHistorySwipe();
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
