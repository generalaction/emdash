import {
  closestCenter,
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useRef, useState } from 'react';
import { projectViewDef } from '@core/features/projects/contributions/views';
import { getTaskStore } from '@core/features/tasks/api/browser/task-state/task-selectors';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { type SidebarRow } from '@core/features/workbench/browser/sidebar/sidebar-store';
import { getSidebarStore } from '@core/features/workbench/contributions/browser/app-stores';
import {
  useViewParams,
  useWorkspaceSlots,
} from '@core/primitives/navigation/browser/navigation-hooks';
import { groupOrderAfterMove, projectPlacementAfterMove } from './group-drop-target';
import { SidebarProjectGroupItem } from './project-group-item';
import { SidebarProjectItem } from './project-item';
import { SidebarTaskItem } from './task-item';

const ROW_HEIGHT = 32;
/** How long a project must hover over a collapsed group before it opens. */
const OPEN_GROUP_DELAY_MS = 600;

export const SidebarVirtualList = observer(function SidebarVirtualList() {
  const sidebar = getSidebarStore();
  const rows = sidebar.sidebarRows;
  const { currentView } = useWorkspaceSlots();
  const taskParams = useViewParams(taskViewDef) ?? {
    projectId: undefined,
    taskId: undefined,
  };
  const projectParams = useViewParams(projectViewDef) ?? { projectId: undefined };

  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  /** Where the dragged row was and how tall the list was when the drag started. */
  const [dragStart, setDragStart] = useState<{ index: number; totalSize: number } | null>(null);
  const openGroupTimerRef = useRef<{
    groupId: string;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const activeTaskProjectExpanded =
    currentView === 'task' && taskParams.projectId
      ? sidebar.expandedProjectIds.has(taskParams.projectId)
      : null;
  const activeProjectId =
    currentView === 'task'
      ? taskParams.projectId
      : currentView === 'project'
        ? projectParams.projectId
        : undefined;
  const activeGroupId = activeProjectId ? sidebar.groupIdForProject(activeProjectId) : undefined;
  const activeGroupCollapsed = activeGroupId ? sidebar.isGroupCollapsed(activeGroupId) : null;
  // Folding for a drag is temporary: hold the values from before it so the
  // effect below does not scroll to the active row when a drag starts or ends.
  const navStateRef = useRef({
    expanded: activeTaskProjectExpanded,
    collapsed: activeGroupCollapsed,
  });
  if (!sidebar.isDragFolded) {
    navStateRef.current = { expanded: activeTaskProjectExpanded, collapsed: activeGroupCollapsed };
  }
  const navExpanded = navStateRef.current.expanded;
  const navCollapsed = navStateRef.current.collapsed;

  const allDndIds = useMemo(() => rows.map(rowToDndId), [rows]);
  const activeDragIndex = activeDragId ? allDndIds.indexOf(activeDragId) : -1;
  // Folding removes rows above the dragged one. Reserve their space instead of
  // scrolling (which the browser clamps near the top), so the dragged row stays
  // exactly where it was picked up, under the pointer, and a drop without moving
  // keeps the order. The list keeps at least its old height so the scroll
  // position is never clamped either.
  const foldOffset =
    dragStart && sidebar.isDragFolded && activeDragIndex !== -1
      ? Math.max(0, (dragStart.index - activeDragIndex) * ROW_HEIGHT)
      : 0;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    paddingStart: foldOffset,
    // Keep the dragged row mounted even when folding moves it out of view.
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range);
      if (activeDragIndex === -1 || indexes.includes(activeDragIndex)) return indexes;
      return [...indexes, activeDragIndex].sort((a, b) => a - b);
    },
  });

  // Scroll the active project/task into view only when the navigation target itself
  // changes, plus the active task's project expansion state and its group's collapse state. Re-running on every
  // `rows` change would yank the user back to the active row whenever the
  // sidebar mutates (e.g. deleting an unrelated task), but direct navigation to a
  // task in a collapsed project needs one rerun after `revealProject`.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  useEffect(() => {
    let targetProjectId: string | null = null;
    let targetTaskId: string | null = null;

    if (currentView === 'task') {
      targetProjectId = taskParams.projectId ?? null;
      targetTaskId = taskParams.taskId ?? null;
    } else if (currentView === 'project') {
      targetProjectId = projectParams.projectId ?? null;
    }

    if (!targetProjectId) return;

    if (targetTaskId) {
      const activeTask = getTaskStore(targetProjectId, targetTaskId);
      if (activeTask?.data.isPinned) {
        return;
      }
    }

    const activeIndex = rowsRef.current.findIndex((row) => {
      if (targetTaskId) {
        return (
          row.kind === 'task' && row.taskId === targetTaskId && row.projectId === targetProjectId
        );
      }
      return row.kind === 'project' && row.projectId === targetProjectId;
    });

    if (activeIndex >= 0) {
      virtualizer.scrollToIndex(activeIndex, { align: 'auto' });
    }
  }, [
    currentView,
    taskParams.projectId,
    taskParams.taskId,
    projectParams.projectId,
    navExpanded,
    navCollapsed,
    virtualizer,
  ]);

  function cancelOpenGroupTimer() {
    if (openGroupTimerRef.current) clearTimeout(openGroupTimerRef.current.timer);
    openGroupTimerRef.current = null;
  }

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    const dragged = parseDndId(id);
    setActiveDragId(id);
    if (!dragged || dragged.kind === 'task') return;
    const index = allDndIds.indexOf(id);
    if (index !== -1) setDragStart({ index, totalSize: virtualizer.getTotalSize() });
    sidebar.beginDragFold(dragged.kind);
  }

  // Hovering a project over a collapsed group for a moment opens it.
  function handleDragOver(event: DragOverEvent) {
    const dragged = parseDndId(String(event.active.id));
    const over = event.over ? parseDndId(String(event.over.id)) : null;
    const groupId =
      dragged?.kind === 'project' &&
      over?.kind === 'group' &&
      sidebar.isGroupCollapsed(over.groupId)
        ? over.groupId
        : null;
    if (openGroupTimerRef.current?.groupId === groupId) return;
    cancelOpenGroupTimer();
    if (!groupId) return;
    openGroupTimerRef.current = {
      groupId,
      timer: setTimeout(() => {
        openGroupTimerRef.current = null;
        sidebar.openGroupWhileDragging(groupId);
      }, OPEN_GROUP_DELAY_MS),
    };
  }

  function endDrag(droppedIntoGroupId?: string | null) {
    cancelOpenGroupTimer();
    setDragStart(null);
    setActiveDragId(null);
    sidebar.endDragFold(droppedIntoGroupId);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    endDrag(over ? applyDrop(rows, String(active.id), String(over.id)) : undefined);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={sidebarCollision}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      autoScroll={{ threshold: { x: 0, y: 0.18 }, acceleration: 8, interval: 5 }}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={() => endDrag()}
    >
      <SortableContext items={allDndIds} strategy={verticalListSortingStrategy}>
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 pt-1 pb-3">
          <div
            style={{
              height: Math.max(virtualizer.getTotalSize(), dragStart?.totalSize ?? 0),
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((vItem) => {
              const row = rows[vItem.index];
              return row ? renderRow(row, vItem.start, vItem.size) : null;
            })}
          </div>
        </div>
      </SortableContext>
      <DragOverlay dropAnimation={null}>
        {activeDragId ? <DragOverlayContent dndId={activeDragId} /> : null}
      </DragOverlay>
    </DndContext>
  );
});

function renderRow(row: SidebarRow, top: number, height: number) {
  const dndId = rowToDndId(row);
  const style: React.CSSProperties = {
    position: 'absolute',
    top,
    left: 0,
    width: '100%',
    height: `${height}px`,
  };
  if (row.kind === 'group') {
    return (
      <SortableRow key={dndId} dndId={dndId} style={style}>
        <SidebarProjectGroupItem groupId={row.groupId} />
      </SortableRow>
    );
  }
  if (row.kind === 'project') {
    return (
      <SortableRow key={row.projectId} dndId={dndId} style={style}>
        <SidebarProjectItem projectId={row.projectId} />
      </SortableRow>
    );
  }
  return (
    <SortableRow key={`${row.projectId}:${row.taskId}`} dndId={dndId} style={style}>
      <SidebarTaskItem projectId={row.projectId} taskId={row.taskId} />
    </SortableRow>
  );
}

const toGroupDndId = (id: string) => `group::${id}`;
const toProjectDndId = (id: string) => `proj::${id}`;
const toTaskDndId = (projectId: string, taskId: string) => `task::${projectId}::${taskId}`;

type SidebarDndId =
  | { kind: 'group'; groupId: string }
  | { kind: 'project'; projectId: string }
  | { kind: 'task'; projectId: string; taskId: string };

function rowToDndId(row: SidebarRow): string {
  if (row.kind === 'group') return toGroupDndId(row.groupId);
  if (row.kind === 'project') return toProjectDndId(row.projectId);
  return toTaskDndId(row.projectId, row.taskId);
}

function parseDndId(id: string): SidebarDndId | null {
  if (id.startsWith('group::')) return { kind: 'group', groupId: id.slice(7) };
  if (id.startsWith('proj::')) return { kind: 'project', projectId: id.slice(6) };
  if (id.startsWith('task::')) {
    const [, projectId, taskId] = id.split('::');
    if (projectId && taskId) return { kind: 'task', projectId, taskId };
  }
  return null;
}

/**
 * While dragging, the sidebar is folded to one level (see `beginDragFold`), so
 * the drop is plain sortable semantics: the dragged row takes the place of the
 * row it is over, exactly as the sliding rows show. Group drags only target
 * group headers, project drags projects and headers, task drags the tasks of
 * their own project.
 */
const sidebarCollision: CollisionDetection = (args) => {
  const dragged = parseDndId(String(args.active.id));
  if (!dragged) return [];
  // The dragged row's own spot stays a target ("stay here"); without it the
  // nearest neighbour counts as hovered and slides as soon as a drag starts.
  const containers = args.droppableContainers.filter((c) => {
    const target = parseDndId(String(c.id));
    if (dragged.kind === 'group') return target?.kind === 'group';
    if (dragged.kind === 'project') return target?.kind === 'group' || target?.kind === 'project';
    return target?.kind === 'task' && target.projectId === dragged.projectId;
  });
  const filteredArgs = { ...args, droppableContainers: containers };
  const pointerCollisions = pointerWithin(filteredArgs);
  return pointerCollisions.length > 0 ? pointerCollisions : closestCenter(filteredArgs);
};

/**
 * Applies a drop of `activeId` onto `overId` in the folded `rows`. Returns the
 * group a project was dropped into (`null` for ungrouped), so a group opened by
 * hovering can stay open.
 */
function applyDrop(
  rows: SidebarRow[],
  activeId: string,
  overId: string
): string | null | undefined {
  const sidebar = getSidebarStore();
  const ids = rows.map(rowToDndId);
  const from = ids.indexOf(activeId);
  const to = ids.indexOf(overId);
  const dragged = parseDndId(activeId);
  if (!dragged || from === -1 || to === -1 || from === to) return undefined;

  if (dragged.kind === 'group') {
    const order = groupOrderAfterMove(rows, from, to);
    const oldPos = sidebar.projectGroups.findIndex((g) => g.id === dragged.groupId);
    const newPos = order.indexOf(dragged.groupId);
    if (oldPos !== -1 && newPos !== -1 && newPos !== oldPos) {
      // `moveGroupTo` counts positions before the group is removed.
      sidebar.moveGroupTo(dragged.groupId, newPos > oldPos ? newPos + 1 : newPos);
    }
    return undefined;
  }

  if (dragged.kind === 'project') {
    const placement = projectPlacementAfterMove(rows, from, to);
    if (!placement) return undefined;
    sidebar.placeProject(dragged.projectId, placement.groupId, placement.index);
    return placement.groupId;
  }

  const over = parseDndId(overId);
  if (over?.kind !== 'task' || over.projectId !== dragged.projectId) return undefined;
  const taskIds = rows
    .filter(
      (r): r is Extract<SidebarRow, { kind: 'task' }> =>
        r.kind === 'task' && r.projectId === dragged.projectId
    )
    .map((r) => r.taskId);
  const oldIdx = taskIds.indexOf(dragged.taskId);
  const newIdx = taskIds.indexOf(over.taskId);
  if (oldIdx !== -1 && newIdx !== -1) {
    sidebar.setTaskOrder(dragged.projectId, arrayMove(taskIds, oldIdx, newIdx));
  }
  return undefined;
}

function DragOverlayContent({ dndId }: { dndId: string }) {
  const parsed = parseDndId(dndId);
  if (!parsed) return null;
  return (
    <div className="px-3">
      <div className="rounded-lg bg-background-tertiary-2 shadow-md">
        {parsed.kind === 'group' ? (
          <SidebarProjectGroupItem groupId={parsed.groupId} />
        ) : parsed.kind === 'project' ? (
          <SidebarProjectItem projectId={parsed.projectId} />
        ) : (
          <SidebarTaskItem projectId={parsed.projectId} taskId={parsed.taskId} />
        )}
      </div>
    </div>
  );
}

interface SortableRowProps {
  dndId: string;
  style: React.CSSProperties;
  children: React.ReactNode;
}

function SortableRow({ dndId, style, children }: SortableRowProps) {
  const { setNodeRef, transform, transition, isDragging, listeners } = useSortable({
    id: dndId,
  });

  const combinedStyle: React.CSSProperties = {
    ...style,
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 1 : 'auto',
  };

  return (
    <div ref={setNodeRef} style={combinedStyle} {...listeners}>
      {children}
    </div>
  );
}
