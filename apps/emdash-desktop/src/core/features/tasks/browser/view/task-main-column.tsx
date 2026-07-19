import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { usePanelRef } from 'react-resizable-panels';
import {
  isTerminalDrawerDragData,
  type TerminalDrawerDragData,
} from '@core/features/terminals/browser/task-terminal/terminal-drag';
import { TerminalsPanel } from '@core/features/terminals/browser/task-terminal/terminal-panel';
import { PaneContent } from '@core/features/workbench/browser/tabs/pane-content';
import { PaneProvider } from '@core/features/workbench/browser/tabs/pane-context';
import type { Pane as PaneGroup } from '@core/features/workbench/browser/tabs/pane-layout-store';
import { TabDragPreview } from '@core/features/workbench/browser/tabs/tab-bar/tab-drag-preview';
import { useTaskComposition } from '@core/features/workbench/browser/task-composition-context';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@renderer/lib/ui/resizable';
import { PaneEmptyState } from '../pane-empty-state';
import { TabBarActions } from '../tab-bar-actions';

type ActiveDrag =
  | { kind: 'tab'; tabId: string }
  | { kind: 'terminal'; terminal: TerminalDrawerDragData };

export const TaskMainColumn = observer(function TaskMainColumn() {
  const taskView = useTaskComposition();
  const { paneLayout } = taskView;
  const bottomPanelRef = usePanelRef();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);

  useEffect(() => {
    if (taskView.isTerminalDrawerOpen) {
      bottomPanelRef.current?.expand();
    } else {
      bottomPanelRef.current?.collapse();
    }
  }, [taskView.isTerminalDrawerOpen, bottomPanelRef]);

  const handleDragStart = (event: DragStartEvent) => {
    const terminalDragData = event.active.data.current;
    if (isTerminalDrawerDragData(terminalDragData)) {
      setActiveDrag({ kind: 'terminal', terminal: terminalDragData });
      return;
    }
    setActiveDrag({ kind: 'tab', tabId: event.active.id as string });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDrag(null);
    if (!event.over) return;

    const terminalDragData = event.active.data.current;
    if (isTerminalDrawerDragData(terminalDragData)) {
      const paneId = resolveDropPaneId(String(event.over.id), paneLayout);
      if (!paneId) return;
      paneLayout.setActiveGroup(paneId);
      paneLayout.open(
        'terminal',
        { terminalId: terminalDragData.terminalId },
        { target: { paneId } }
      );
      return;
    }

    paneLayout.handleDragEnd(event.active.id as string, event.over.id as string);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveDrag(null)}
    >
      <ResizablePanelGroup orientation="vertical" id="task-main-vertical">
        <ResizablePanel id="task-main-content" minSize="30%">
          <SplitPaneLayout />
        </ResizablePanel>
        <ResizableHandle className={taskView.isTerminalDrawerOpen ? 'flex' : 'hidden'} />
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
        {activeDrag?.kind === 'tab' ? (
          <TabDragPreview tabId={activeDrag.tabId} />
        ) : activeDrag?.kind === 'terminal' ? (
          <TerminalDragPreview label={activeDrag.terminal.label} />
        ) : null}
      </DragOverlay>
    </DndContext>
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
  onActivate,
  defaultSizePct,
}: {
  group: PaneGroup;
  index: number;
  onActivate: () => void;
  defaultSizePct: number;
}) {
  const taskView = useTaskComposition();
  const canSplit = group.pane.resolvedTabs.length >= 2 && taskView.paneLayout.groups.length < 3;
  return (
    <>
      {index > 0 && <ResizableHandle />}
      <ResizablePanel
        id={`pane-${group.paneId}`}
        defaultSize={`${defaultSizePct}%`}
        minSize="200px"
        onPointerDown={onActivate}
      >
        <PaneProvider
          group={group}
          canSplit={canSplit}
          splitPane={() => taskView.paneLayout.splitRight()}
        >
          <PaneContent emptyState={<PaneEmptyState />} actionsSlot={<TabBarActions />} />
        </PaneProvider>
      </ResizablePanel>
    </>
  );
});

/** Renders one vertical pane per tab group inside a ResizablePanelGroup. */
const SplitPaneLayout = observer(function SplitPaneLayout() {
  const taskView = useTaskComposition();
  const { paneLayout } = taskView;

  return (
    <ResizablePanelGroup orientation="horizontal" id="task-main-split">
      {paneLayout.groups.map((group, i) => (
        <SplitPane
          key={group.paneId}
          group={group}
          index={i}
          onActivate={() => paneLayout.setActiveGroup(group.paneId)}
          defaultSizePct={paneLayout.paneSizes[i] ?? Math.floor(100 / paneLayout.groups.length)}
        />
      ))}
    </ResizablePanelGroup>
  );
});

function resolveDropPaneId(
  overId: string,
  paneLayout: ReturnType<typeof useTaskComposition>['paneLayout']
): string | undefined {
  if (overId.startsWith('pane-drop-')) return overId.slice('pane-drop-'.length);
  if (overId.startsWith('pane-content-')) return overId.slice('pane-content-'.length);
  return paneLayout.groups.find((group) => group.pane.entries.has(overId))?.paneId;
}

function TerminalDragPreview({ label }: { label: string }) {
  return (
    <div className="flex cursor-grabbing items-center gap-1.5 rounded-md border border-border bg-background-secondary-1 px-2 py-1 text-sm opacity-80 shadow-lg">
      <span className="max-w-[200px] truncate">{label}</span>
    </div>
  );
}
