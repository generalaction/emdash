import { ReactNode } from 'react';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { useWorkspaceLayoutContext } from '@/contexts/WorkspaceLayoutProvider';
import { cn } from '@/lib/utils';

const LEFT_PANEL_DEFAULT_SIZE = 20;
const RIGHT_PANEL_DEFAULT_SIZE = 20;
const LEFT_SIDEBAR_MIN_SIZE = 16;
const LEFT_SIDEBAR_MAX_SIZE = 30;
const MAIN_PANEL_MIN_SIZE = 30;
const RIGHT_SIDEBAR_MIN_SIZE = 16;
const RIGHT_SIDEBAR_MAX_SIZE = 50;

interface WorkspaceLayoutProps {
  leftSidebar: ReactNode;
  mainContent: ReactNode;
}

export function WorkspaceLayout({ leftSidebar, mainContent }: WorkspaceLayoutProps) {
  const { leftPanelRef, handleDragging, setIsLeftOpen, isLeftOpen } = useWorkspaceLayoutContext();

  return (
    <ResizablePanelGroup
      autoSaveId="workspace-outer"
      direction="horizontal"
      className="h-full w-full overflow-hidden"
      storage={localStorage}
    >
      <ResizablePanel
        ref={leftPanelRef}
        defaultSize={LEFT_PANEL_DEFAULT_SIZE}
        minSize={LEFT_SIDEBAR_MIN_SIZE}
        maxSize={LEFT_SIDEBAR_MAX_SIZE}
        collapsedSize={0}
        onCollapse={() => setIsLeftOpen(false)}
        onExpand={() => setIsLeftOpen(true)}
        collapsible
      >
        {leftSidebar}
      </ResizablePanel>
      <ResizableHandle
        withHandle
        onDragging={(d) => handleDragging('left', d)}
        className={cn(
          'cursor-col-resize items-center justify-center transition-colors hover:bg-border/80',
          isLeftOpen ? 'flex' : 'hidden'
        )}
      />
      <ResizablePanel minSize={MAIN_PANEL_MIN_SIZE}>{mainContent}</ResizablePanel>
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

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {titlebarSlot}
      <ResizablePanelGroup
        autoSaveId="workspace-inner"
        direction="horizontal"
        className="flex-1 overflow-hidden"
        storage={localStorage}
      >
        <ResizablePanel minSize={MAIN_PANEL_MIN_SIZE}>
          <div className="flex h-full flex-col overflow-hidden">{mainPanel}</div>
        </ResizablePanel>
        {hasRight && (
          <>
            <ResizableHandle
              withHandle
              onDragging={(d) => handleDragging('right', d)}
              className={cn(
                'cursor-col-resize items-center justify-center transition-colors hover:bg-border/80',
                isRightOpen ? 'flex' : 'hidden'
              )}
            />
            <ResizablePanel
              ref={rightPanelRef}
              defaultSize={RIGHT_PANEL_DEFAULT_SIZE}
              minSize={RIGHT_SIDEBAR_MIN_SIZE}
              maxSize={RIGHT_SIDEBAR_MAX_SIZE}
              collapsedSize={0}
              onCollapse={() => setIsRightOpen(false)}
              onExpand={() => setIsRightOpen(true)}
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
