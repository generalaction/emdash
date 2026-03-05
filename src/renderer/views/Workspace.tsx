import { WorkspaceLayout, WorkspaceContentLayout } from '@/components/WorkspaceLayout';
import { WorkspaceEffects } from '@/components/WorkspaceEffects';
import { useWorkspaceSlots, useWorkspaceWrapParams } from '@/contexts/WorkspaceViewProvider';
import { ModalRenderer } from '@/components/ModalRenderer';
import { useTheme } from '@/hooks/useTheme';
import { LeftSidebar } from '@/components/sidebar/LeftSidebar';

export function Workspace() {
  useTheme();
  const { WrapView } = useWorkspaceSlots();
  const { wrapParams } = useWorkspaceWrapParams();
  return (
    <>
      <WorkspaceEffects />
      <WorkspaceLayout
        leftSidebar={<LeftSidebar />}
        mainContent={
          <WrapView {...wrapParams}>
            <WorkspaceViewContent />
          </WrapView>
        }
      />
      <ModalRenderer />
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
