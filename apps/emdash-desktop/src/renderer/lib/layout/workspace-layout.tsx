import { Resizable, useCollapsiblePanelBinding } from '@emdash/ui/react/primitives';
import { type ReactNode } from 'react';
import { useWorkspaceLayoutContext } from '@core/features/workbench/contributions/browser/layout-provider';

const LEFT_PANEL_DEFAULT_SIZE = '20%';
const LEFT_SIDEBAR_MAX_SIZE = '30%';
const MAIN_PANEL_MIN_SIZE = '30%';

// Drag-to-close threshold for the left sidebar, in percent of the group.
// 200px — the old resize floor — is at least 8% of the group on any window up
// to 2500px wide, so every width the previous UI let a user settle at stays a
// plain resize/restore, never a surprise close. Below 8% (~115px at 1440px)
// the sidebar content is unusable, so a drag settling there reads as intent
// to close rather than a resize.
const LEFT_SIDEBAR_CLOSE_THRESHOLD = 8;

interface WorkspaceLayoutProps {
  leftSidebar: ReactNode;
  mainContent: ReactNode;
}

export function WorkspaceLayout({ leftSidebar, mainContent }: WorkspaceLayoutProps) {
  const { isLeftOpen, toggleLeftSidebar, layoutStorage, layoutKey } = useWorkspaceLayoutContext();
  const binding = useCollapsiblePanelBinding({
    storageKey: 'workspace-outer',
    storage: layoutStorage,
    panelIds: ['workspace-left', 'workspace-main'],
    collapsiblePanelId: 'workspace-left',
    open: isLeftOpen,
    // Only reachable while open, so toggle is the semantic close command.
    onCloseRequest: () => toggleLeftSidebar(),
    closeThreshold: LEFT_SIDEBAR_CLOSE_THRESHOLD,
  });

  return (
    <Resizable.Group
      key={layoutKey}
      id="workspace-outer"
      orientation="horizontal"
      {...binding.groupProps}
    >
      {/* Closed = panel AND handle unmounted (sync contract: never program
          the panels). */}
      {isLeftOpen && (
        <>
          <Resizable.Panel
            {...binding.collapsiblePanelProps}
            defaultSize={binding.collapsiblePanelProps.defaultSize ?? LEFT_PANEL_DEFAULT_SIZE}
            maxSize={LEFT_SIDEBAR_MAX_SIZE}
          >
            {leftSidebar}
          </Resizable.Panel>
          <Resizable.Handle variant="ghost" />
        </>
      )}
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
