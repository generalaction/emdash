import { ModalRenderer } from '@renderer/components/ModalRenderer';
import { LeftSidebar } from '@renderer/components/sidebar/LeftSidebar';
import { WorkspaceEffects } from '@renderer/components/WorkspaceEffects';
import { WorkspaceContentLayout, WorkspaceLayout } from '@renderer/components/WorkspaceLayout';
import {
  useWorkspaceSlots,
  useWorkspaceWrapParams,
} from '@renderer/contexts/WorkspaceViewProvider';
import { useTheme } from '@renderer/hooks/useTheme';

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
