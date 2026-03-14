import { ModalRenderer } from '@renderer/components/ModalRenderer';
import { LeftSidebar } from '@renderer/components/sidebar/left-sidebar';
import { Toaster } from '@renderer/components/ui/toaster';
import { WorkspaceContentLayout, WorkspaceLayout } from '@renderer/components/WorkspaceLayout';
import {
  useWorkspaceSlots,
  useWorkspaceWrapParams,
} from '@renderer/contexts/WorkspaceNavigationContext';
import { useTheme } from '@renderer/hooks/useTheme';

export function Workspace() {
  useTheme();
  const { WrapView } = useWorkspaceSlots();
  const { wrapParams } = useWorkspaceWrapParams();
  return (
    <>
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
  return (
    <WorkspaceContentLayout
      titlebarSlot={<TitlebarSlot />}
      mainPanel={<MainPanel />}
      rightPanel={RightPanel ? <RightPanel /> : null}
    />
  );
}
