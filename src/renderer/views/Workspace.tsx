import { WorkspaceLayout } from '@/components/WorkspaceLayout';
import { WorkspaceEffects } from '@/components/WorkspaceEffects';
import { useWorkspaceSlots, useWorkspaceWrapParams } from '@/contexts/WorkspaceViewProvider';
import { ModalRenderer } from '@/components/ModalRenderer';
import { useTheme } from '@/hooks/useTheme';

export function Workspace() {
  useTheme();
  const { WrapView } = useWorkspaceSlots();
  const { wrapParams } = useWorkspaceWrapParams();
  return (
    <>
      <WorkspaceEffects />
      <WrapView {...wrapParams}>
        <WorkspaceSlots />
      </WrapView>
      <ModalRenderer />
    </>
  );
}

function WorkspaceSlots() {
  const { TitlebarSlot, MainPanel, RightPanel } = useWorkspaceSlots();
  return (
    <WorkspaceLayout
      titlebarSlot={<TitlebarSlot />}
      mainPanel={<MainPanel />}
      rightPanel={RightPanel ? <RightPanel /> : null}
    />
  );
}
