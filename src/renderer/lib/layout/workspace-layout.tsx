import { ReactNode } from 'react';
import { useDefaultLayout } from 'react-resizable-panels';
import { useWorkspaceLayoutContext } from '@renderer/lib/layout/layout-provider';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@renderer/lib/ui/resizable';
import { cn } from '@renderer/utils/utils';

const LEFT_PANEL_DEFAULT_SIZE = 20;
const RIGHT_PANEL_DEFAULT_SIZE = 25;
const LEFT_SIDEBAR_MIN_SIZE = 16;
const LEFT_SIDEBAR_MAX_SIZE = 30;
const MAIN_PANEL_MIN_SIZE = 30;
const RIGHT_SIDEBAR_MIN_SIZE = 23;
const RIGHT_SIDEBAR_MAX_SIZE = 50;

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
      className="h-full w-full overflow-hidden"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
    >
      <ResizablePanel
        id="workspace-left"
        panelRef={leftPanelRef}
        defaultSize={`${LEFT_PANEL_DEFAULT_SIZE}%`}
        minSize={`${LEFT_SIDEBAR_MIN_SIZE}%`}
        maxSize={`${LEFT_SIDEBAR_MAX_SIZE}%`}
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
      <ResizablePanel id="workspace-main" minSize={`${MAIN_PANEL_MIN_SIZE}%`}>
        {mainContent}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

interface WorkspaceContentLayoutProps {
  titlebarSlot: ReactNode;
  mainPanel: ReactNode;
  rightPanel?: ReactNode;
}

export function WorkspaceContentLayout({
  titlebarSlot,
  mainPanel,
  rightPanel = null,
}: WorkspaceContentLayoutProps) {
  const { rightPanelRef, handleDragging, setIsRightOpen, isRightOpen } =
    useWorkspaceLayoutContext();

  const hasRight = Boolean(rightPanel);

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'workspace-inner',
    storage: localStorage,
  });

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {titlebarSlot}
      <ResizablePanelGroup
        id="workspace-inner"
        orientation="horizontal"
        className="flex-1 overflow-hidden"
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
      >
        <ResizablePanel id="workspace-inner-main" minSize={`${MAIN_PANEL_MIN_SIZE}%`}>
          <div className="flex h-full flex-col overflow-hidden">{mainPanel}</div>
        </ResizablePanel>
        {hasRight && (
          <>
            <ResizableHandle
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                handleDragging('right', true);
              }}
              onPointerUp={() => handleDragging('right', false)}
              onPointerCancel={() => handleDragging('right', false)}
              className={cn(
                'items-center justify-center transition-colors hover:bg-border/80',
                isRightOpen ? 'flex' : 'hidden'
              )}
            />
            <ResizablePanel
              id="workspace-inner-right"
              panelRef={rightPanelRef}
              defaultSize={`${RIGHT_PANEL_DEFAULT_SIZE}%`}
              minSize={`${RIGHT_SIDEBAR_MIN_SIZE}%`}
              maxSize={`${RIGHT_SIDEBAR_MAX_SIZE}%`}
              collapsedSize="0%"
              onResize={() => setIsRightOpen(!rightPanelRef.current?.isCollapsed())}
              collapsible
            >
              {rightPanel}
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  );
}
