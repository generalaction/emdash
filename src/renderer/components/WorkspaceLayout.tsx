import { ReactNode } from 'react';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { useWorkspaceLayoutContext } from '@/contexts/WorkspaceLayoutProvider';
import Titlebar from '@/components/titlebar/Titlebar';
import { cn } from '@/lib/utils';
import { LeftSidebar } from '@/components/sidebar/LeftSidebar';

const TITLEBAR_HEIGHT = '36px';
const LEFT_PANEL_DEFAULT_SIZE = 20;
const RIGHT_PANEL_DEFAULT_SIZE = 20;
const LEFT_SIDEBAR_MIN_SIZE = 16;
const LEFT_SIDEBAR_MAX_SIZE = 30;
const MAIN_PANEL_MIN_SIZE = 30;
const RIGHT_SIDEBAR_MIN_SIZE = 16;
const RIGHT_SIDEBAR_MAX_SIZE = 50;

interface WorkspaceLayoutProps {
  titlebarSlot: ReactNode;
  mainPanel: ReactNode;
  rightPanel?: ReactNode;
}

export function WorkspaceLayout({
  titlebarSlot,
  mainPanel,
  rightPanel = null,
}: WorkspaceLayoutProps) {
  const {
    leftPanelRef,
    rightPanelRef,
    handleDragging,
    setIsLeftOpen,
    setIsRightOpen,
    isRightOpen,
    isLeftOpen,
  } = useWorkspaceLayoutContext();

  return (
    <div
      className="flex h-[100dvh] w-full flex-col bg-background text-foreground"
      style={{ '--tb': TITLEBAR_HEIGHT } as React.CSSProperties}
    >
      <Titlebar>{titlebarSlot}</Titlebar>
      <div className="flex flex-1 overflow-hidden pt-[var(--tb)]">
        <ResizablePanelGroup
          autoSaveId="workspace-layout-panel-group"
          direction="horizontal"
          className="flex-1 overflow-hidden"
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
            order={1}
          >
            <LeftSidebar />
          </ResizablePanel>
          <ResizableHandle
            withHandle
            onDragging={(d) => handleDragging('left', d)}
            className={cn(
              'cursor-col-resize items-center justify-center transition-colors hover:bg-border/80',
              isLeftOpen ? 'flex' : 'hidden'
            )}
          />
          <ResizablePanel minSize={MAIN_PANEL_MIN_SIZE} order={2}>
            <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
              {mainPanel}
            </div>
          </ResizablePanel>
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
            order={3}
          >
            {rightPanel ?? null}
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
