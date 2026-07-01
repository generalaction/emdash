import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { usePanelRef } from 'react-resizable-panels';
import { PaneContent } from '@renderer/features/tabs/pane-content';
import { PaneProvider } from '@renderer/features/tabs/pane-context';
import { PaneDimensionProvider } from '@renderer/features/tabs/pane-dimension-provider';
import type { Pane as PaneGroup } from '@renderer/features/tabs/pane-layout-store';
import { TabDragPreview } from '@renderer/features/tabs/tab-bar/tab-drag-preview';
import { panelDragStore } from '@renderer/lib/layout/panel-drag-store';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@renderer/lib/ui/resizable';
import { PaneEmptyState } from '../pane-empty-state';
import { TabBarActions } from '../tab-bar-actions';
import { taskTabView } from '../task-tab-registry';
import { useWorkspaceViewModel } from '../task-view-context';
import {
  isTerminalDrawerDragData,
  type TerminalDrawerDragData,
} from '../terminals/terminal-drawer-dnd';
import { TerminalDrawerDragPreview } from '../terminals/terminal-drawer-sidebar';
import { TerminalsPanel } from '../terminals/terminal-panel';

export const TaskMainColumn = observer(function TaskMainColumn() {
  const taskView = useWorkspaceViewModel();
  const bottomPanelRef = usePanelRef();
  const { paneLayout } = taskView;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [activeTerminalDrag, setActiveTerminalDrag] = useState<TerminalDrawerDragData | null>(null);

  useEffect(() => {
    panelDragStore.suppressFor(140);
    if (taskView.isTerminalDrawerOpen) {
      bottomPanelRef.current?.expand();
    } else {
      bottomPanelRef.current?.collapse();
    }
  }, [taskView.isTerminalDrawerOpen, bottomPanelRef]);

  const handleDragEnd = (event: DragEndEvent) => {
    const terminalDrag = isTerminalDrawerDragData(event.active.data.current)
      ? event.active.data.current
      : null;

    setActiveDragId(null);
    setActiveTerminalDrag(null);

    if (!event.over) return;

    if (terminalDrag) {
      const pane = findPaneForDrop(paneLayout, event.over.id as string);
      if (pane) taskView.openTerminalTab(terminalDrag.terminalId, { pane });
      return;
    }

    paneLayout.handleDragEnd(event.active.id as string, event.over.id as string);
  };

  return (
    <taskTabView.TabLayoutProvider layout={paneLayout}>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={({ active }) => {
          setActiveDragId(active.id as string);
          setActiveTerminalDrag(
            isTerminalDrawerDragData(active.data.current) ? active.data.current : null
          );
        }}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setActiveDragId(null);
          setActiveTerminalDrag(null);
        }}
      >
        <ResizablePanelGroup orientation="vertical" id="task-main-vertical">
          <ResizablePanel id="task-main-content" minSize="30%">
            <SplitPaneLayout />
          </ResizablePanel>
          <DraggableResizeHandle className={taskView.isTerminalDrawerOpen ? 'flex' : 'hidden'} />
          <ResizablePanel
            id="task-terminal-drawer"
            panelRef={bottomPanelRef}
            collapsible
            collapsedSize="0%"
            defaultSize="25%"
            minSize="15%"
            onResize={(_panelSize, _id, prevPanelSize) => {
              if (prevPanelSize === undefined) return;
              taskView.setTerminalDrawerOpen(!bottomPanelRef.current?.isCollapsed());
            }}
          >
            <TerminalsPanel />
          </ResizablePanel>
        </ResizablePanelGroup>
        <DragOverlay dropAnimation={null}>
          {activeTerminalDrag ? (
            <TerminalDrawerDragPreview label={activeTerminalDrag.label} />
          ) : activeDragId ? (
            <TabDragPreview tabId={activeDragId} />
          ) : null}
        </DragOverlay>
      </DndContext>
    </taskTabView.TabLayoutProvider>
  );
});

/**
 * One horizontal split pane: optional resize handle + resizable panel +
 * PaneProvider + PaneDimensionProvider + PaneContent.
 */
const SplitPane = observer(function SplitPane({
  group,
  index,
  isFocused,
  onActivate,
  defaultSizePct,
}: {
  group: PaneGroup;
  index: number;
  isFocused: boolean;
  onActivate: () => void;
  defaultSizePct: number;
}) {
  return (
    <PaneProvider group={group} isFocusedPane={isFocused}>
      {index > 0 && <ResizableHandle />}
      <ResizablePanel
        id={`pane-${group.paneId}`}
        defaultSize={`${defaultSizePct}%`}
        minSize="200px"
        onPointerDown={onActivate}
      >
        <PaneDimensionProvider sink={group.pane}>
          <PaneContent emptyState={<PaneEmptyState />} actionsSlot={<TabBarActions />} />
        </PaneDimensionProvider>
      </ResizablePanel>
    </PaneProvider>
  );
});

/** Renders one vertical pane per tab group inside a ResizablePanelGroup. */
const SplitPaneLayout = observer(function SplitPaneLayout() {
  const taskView = useWorkspaceViewModel();
  const { paneLayout } = taskView;

  return (
    <ResizablePanelGroup orientation="horizontal" id="task-main-split">
      {paneLayout.groups.map((group, i) => (
        <SplitPane
          key={group.paneId}
          group={group}
          index={i}
          isFocused={taskView.focusedRegion === 'main' && paneLayout.activePaneId === group.paneId}
          onActivate={() => paneLayout.setActiveGroup(group.paneId)}
          defaultSizePct={paneLayout.paneSizes[i] ?? Math.floor(100 / paneLayout.groups.length)}
        />
      ))}
    </ResizablePanelGroup>
  );
});

function findPaneForDrop(
  paneLayout: ReturnType<typeof taskTabView.createPaneLayoutStore>,
  overId: string
) {
  let paneId: string | undefined;
  if (overId.startsWith('pane-drop-') || overId.startsWith('pane-content-')) {
    paneId = overId.startsWith('pane-drop-')
      ? overId.slice('pane-drop-'.length)
      : overId.slice('pane-content-'.length);
  } else {
    paneId = paneLayout.groups.find((group) => group.pane.entries.has(overId))?.paneId;
  }

  return paneLayout.groups.find((group) => group.paneId === paneId)?.pane ?? null;
}

/**
 * ResizableHandle wrapper that flips panelDragStore on/off during a drag so
 * embedded terminals can suppress fits while the user is dragging.
 */
export function DraggableResizeHandle(props: ComponentProps<typeof ResizableHandle>) {
  const draggingRef = useRef(false);
  const stop = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    panelDragStore.setDragging(false);
  };
  return (
    <ResizableHandle
      {...props}
      onPointerDown={(e) => {
        props.onPointerDown?.(e);
        e.currentTarget.setPointerCapture(e.pointerId);
        if (!draggingRef.current) {
          draggingRef.current = true;
          panelDragStore.setDragging(true);
        }
      }}
      onPointerUp={(e) => {
        props.onPointerUp?.(e);
        stop();
      }}
      onPointerCancel={(e) => {
        props.onPointerCancel?.(e);
        stop();
      }}
    />
  );
}
