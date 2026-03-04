import { SidebarProvider } from '@/components/ui/sidebar';
import { WorkspaceLayout } from '@/components/WorkspaceLayout';
import { useWorkspaceSlots, useWorkspaceWrapParams } from '@/contexts/WorkspaceViewProvider';

export function Workspace() {
  const { WrapView } = useWorkspaceSlots();
  const { wrapParams } = useWorkspaceWrapParams();
  return (
    <SidebarProvider>
      <WrapView {...wrapParams}>
        <WorkspaceSlots />
      </WrapView>
    </SidebarProvider>
  );
}

function WorkspaceSlots() {
  const { TitlebarSlot, MainPanel, RightPanel } = useWorkspaceSlots();
  return (
    <WorkspaceLayout
      titlebarSlot={<TitlebarSlot />}
      mainPanel={<MainPanel />}
      rightPanel={<RightPanel />}
    />
  );
}
