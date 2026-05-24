import { type ReactNode } from 'react';
import { useDefaultLayout } from 'react-resizable-panels';
import { useWorkspaceLayoutContext } from '@renderer/lib/layout/layout-provider';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@renderer/lib/ui/resizable';
import { cn } from '@renderer/utils/utils';

const LEFT_PANEL_DEFAULT_SIZE = '20%';
const LEFT_SIDEBAR_MIN_SIZE = '200px';
const LEFT_SIDEBAR_MAX_SIZE = '30%';
const MAIN_PANEL_MIN_SIZE = '30%';

interface WorkspaceLayoutProps {
  leftSidebar: ReactNode;
  mainContent: ReactNode;
}

export function WorkspaceLayout({ leftSidebar, mainContent }: WorkspaceLayoutProps) {
  const { leftPanelRef, handleDragging, setIsLeftOpen, isLeftOpen } = useWorkspaceLayoutContext();
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'workspace-outer',
    storage: localStorage,
  });

  return (
    <ResizablePanelGroup
      id="workspace-outer"
      orientation="horizontal"
      className="size-full overflow-hidden"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
    >
      <ResizablePanel
        id="workspace-left"
        panelRef={leftPanelRef}
        defaultSize={LEFT_PANEL_DEFAULT_SIZE}
        minSize={LEFT_SIDEBAR_MIN_SIZE}
        maxSize={LEFT_SIDEBAR_MAX_SIZE}
        collapsedSize="0%"
        onResize={() => setIsLeftOpen(!leftPanelRef.current?.isCollapsed())}
        collapsible
      >
        {leftSidebar}
      </ResizablePanel>
      <ResizableHandle
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          handleDragging('left', true);
        }}
        onPointerUp={() => handleDragging('left', false)}
        onPointerCancel={() => handleDragging('left', false)}
        className={cn(
          'items-center justify-center transition-colors hover:bg-border/80',
          isLeftOpen ? 'flex' : 'hidden'
        )}
      />
      <ResizablePanel id="workspace-main" minSize={MAIN_PANEL_MIN_SIZE}>
        {mainContent}
      </ResizablePanel>
    </ResizablePanelGroup>
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
