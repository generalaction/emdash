import {
  DndContext,
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
import type { Pane as PaneGroup } from '@renderer/features/tabs/pane-layout-store';
import { TabDragPreview } from '@renderer/features/tabs/tab-bar/tab-drag-preview';
import { panelDragStore } from '@renderer/lib/layout/panel-drag-store';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@renderer/lib/ui/resizable';
import { PaneEmptyState } from '../pane-empty-state';
import { TabBarActions } from '../tab-bar-actions';
import { useWorkspaceViewModel } from '../task-view-context';
import { TerminalsPanel } from '../terminals/terminal-panel';

export const TaskMainColumn = observer(function TaskMainColumn() {
  const taskView = useWorkspaceViewModel();
  const bottomPanelRef = usePanelRef();

  useEffect(() => {
    panelDragStore.suppressFor(140);
    if (taskView.isTerminalDrawerOpen) {
      bottomPanelRef.current?.expand();
    } else {
      bottomPanelRef.current?.collapse();
    }
  }, [taskView.isTerminalDrawerOpen, bottomPanelRef]);

  return (
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
  );
});

/**
 * One horizontal split pane: optional resize handle + resizable panel +
 * PaneProvider + PaneContent (which self-hosts PaneDimensionProvider on its
 * content region so the TabBar is excluded from the measured dimensions).
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
        <PaneContent emptyState={<PaneEmptyState />} actionsSlot={<TabBarActions />} />
      </ResizablePanel>
    </PaneProvider>
  );
});

/** Renders one vertical pane per tab group inside a ResizablePanelGroup. */
const SplitPaneLayout = observer(function SplitPaneLayout() {
  const taskView = useWorkspaceViewModel();
  const { paneLayout } = taskView;

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  // Re-measure all pane containers after any layout change (panes added/removed/resized).
  // Uses a double rAF so the measurement runs after React commits and the layout lib
  // has applied the new panel sizes. This ensures PTY controllerDims stays accurate even
  // when the active tab is a non-terminal (file/diff) and no ResizeObserver event fired.
  const layoutSig =
    paneLayout.groups.map((g) => g.paneId).join(',') + '|' + paneLayout.paneSizes.join(',');
  useEffect(() => {
    const outer = requestAnimationFrame(() => {
      const inner = requestAnimationFrame(() => {
        for (const g of paneLayout.groups) g.pane.remeasure();
      });
      return inner;
    });
    return () => cancelAnimationFrame(outer);
    // paneLayout.groups is captured by layoutSig; accessing it live inside the rAF
    // is intentional so we remeasure the panes that actually exist at paint time.
    // oxlint-disable-next-line react/exhaustive-deps
  }, [layoutSig]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={({ active }) => setActiveDragId(active.id as string)}
      onDragEnd={(event) => {
        setActiveDragId(null);
        if (event.over) {
          paneLayout.handleDragEnd(event.active.id as string, event.over.id as string);
        }
      }}
      onDragCancel={() => setActiveDragId(null)}
    >
      <ResizablePanelGroup orientation="horizontal" id="task-main-split">
        {paneLayout.groups.map((group, i) => (
          <SplitPane
            key={group.paneId}
            group={group}
            index={i}
            isFocused={
              taskView.focusedRegion === 'main' && paneLayout.activePaneId === group.paneId
            }
            onActivate={() => paneLayout.setActiveGroup(group.paneId)}
            defaultSizePct={paneLayout.paneSizes[i] ?? Math.floor(100 / paneLayout.groups.length)}
          />
        ))}
      </ResizablePanelGroup>
      <DragOverlay dropAnimation={null}>
        {activeDragId ? <TabDragPreview tabId={activeDragId} /> : null}
      </DragOverlay>
    </DndContext>
  );
});

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
