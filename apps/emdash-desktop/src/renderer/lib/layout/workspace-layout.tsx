import { Resizable, useResizableDefaultLayout } from '@emdash/ui/react/primitives';
import { type ReactNode } from 'react';
import { useWorkspaceLayoutContext } from '@core/primitives/workbench-shell/browser/layout-provider';

const LEFT_PANEL_DEFAULT_SIZE = '20%';
const LEFT_SIDEBAR_MIN_SIZE = '200px';
const LEFT_SIDEBAR_MAX_SIZE = '30%';
const MAIN_PANEL_MIN_SIZE = '30%';

interface WorkspaceLayoutProps {
  leftSidebar: ReactNode;
  mainContent: ReactNode;
}

export function WorkspaceLayout({ leftSidebar, mainContent }: WorkspaceLayoutProps) {
  const { leftPanelRef, syncLeftOpenFromPanel, isLeftOpen } = useWorkspaceLayoutContext();
  const { defaultLayout, onLayoutChanged } = useResizableDefaultLayout({
    id: 'workspace-outer',
    storage: localStorage,
  });

  return (
    <Resizable.Group
      id="workspace-outer"
      orientation="horizontal"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
    >
      <Resizable.Panel
        id="workspace-left"
        panelRef={leftPanelRef}
        defaultSize={LEFT_PANEL_DEFAULT_SIZE}
        minSize={LEFT_SIDEBAR_MIN_SIZE}
        maxSize={LEFT_SIDEBAR_MAX_SIZE}
        collapsedSize="0%"
        onResize={syncLeftOpenFromPanel}
        collapsible
      >
        {leftSidebar}
      </Resizable.Panel>
      <Resizable.Handle variant="ghost" hidden={!isLeftOpen} />
      <Resizable.Panel id="workspace-main" minSize={MAIN_PANEL_MIN_SIZE}>
        {mainContent}
      </Resizable.Panel>
    </Resizable.Group>
  );
}

interface WorkspaceContentLayoutProps {
  titlebarSlot: ReactNode;
  mainPanel: ReactNode;
}

export function WorkspaceContentLayout({ titlebarSlot, mainPanel }: WorkspaceContentLayoutProps) {
  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {titlebarSlot}
      <div className="flex-1 overflow-hidden">
        <div className="flex h-full flex-col overflow-hidden">{mainPanel}</div>
      </div>
    </div>
  );
}
