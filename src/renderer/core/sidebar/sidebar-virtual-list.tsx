import {
  closestCenter,
  CollisionDetection,
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useVirtualizer } from '@tanstack/react-virtual';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import { sidebarStore } from '@renderer/core/stores/app-state';
import { SidebarRow } from '@renderer/core/stores/sidebar-store';
import { getTaskStore } from '@renderer/core/stores/task-selectors';
import { useParams, useWorkspaceSlots } from '@renderer/core/view/navigation-provider';
import { SidebarProjectItem } from './project-item';
import { SidebarTaskItem } from './task-item';

const ROW_HEIGHT = 32;

export const SidebarVirtualList = observer(function SidebarVirtualList() {
  const rows = sidebarStore.sidebarRows;
  const { currentView } = useWorkspaceSlots();
  const { params: taskParams } = useParams('task');
  const { params: projectParams } = useParams('project');

  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // During a project drag, collapse its task children so the list is compact
  // and project rows are adjacent — making cross-project reorder easier.
  const draggingProjectId = activeId?.startsWith('proj::') ? activeId.slice(6) : null;
  const displayRows = draggingProjectId
    ? rows.filter((r) => !(r.kind === 'task' && r.projectId === draggingProjectId))
    : rows;

  const allDndIds = displayRows.map(rowToDndId);

  const virtualizer = useVirtualizer({
    count: displayRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  // Expand the parent project when navigating to a task (not when `rows` changes —
  // otherwise collapsing while staying on that task would immediately re-expand).
  useEffect(() => {
    if (currentView !== 'task') return;
    const targetProjectId = taskParams.projectId;
    const targetTaskId = taskParams.taskId;
    if (!targetProjectId || !targetTaskId) return;
    const activeTask = getTaskStore(targetProjectId, targetTaskId);
    if (activeTask?.data.isPinned) return;
    sidebarStore.ensureProjectExpanded(targetProjectId);
  }, [currentView, taskParams.projectId, taskParams.taskId]);

  // Scroll the active project/task into view when navigation or row layout changes.
  useEffect(() => {
    let targetProjectId: string | null = null;
    let targetTaskId: string | null = null;

    if (currentView === 'task') {
      targetProjectId = taskParams.projectId;
      targetTaskId = taskParams.taskId;
    } else if (currentView === 'project') {
      targetProjectId = projectParams.projectId;
    }

    if (!targetProjectId) return;

    if (targetTaskId) {
      const activeTask = getTaskStore(targetProjectId, targetTaskId);
      if (activeTask?.data.isPinned) {
        return;
      }
    }

    const activeIndex = displayRows.findIndex((row) => {
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
    displayRows,
    virtualizer,
  ]);

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const a = String(active.id);
    const o = String(over.id);

    if (a.startsWith('proj::') && o.startsWith('proj::')) {
      const ids = sidebarStore.orderedProjects
        .map((p) => (p.state === 'unregistered' ? p.id : (p.data?.id ?? '')))
        .filter(Boolean);
      const oldIdx = ids.indexOf(a.slice(6));
      const newIdx = ids.indexOf(o.slice(6));
      if (oldIdx !== -1 && newIdx !== -1) {
        sidebarStore.setProjectOrder(arrayMove(ids, oldIdx, newIdx));
      }
    } else if (a.startsWith('task::') && o.startsWith('task::')) {
      const [, aProjId, aTaskId] = a.split('::');
      const [, oProjId, oTaskId] = o.split('::');
      if (aProjId !== oProjId) return;
      const taskIds = sidebarStore.sidebarRows
        .filter((r) => r.kind === 'task' && r.projectId === aProjId)
        .map((r) => (r as { taskId: string }).taskId);
      const oldIdx = taskIds.indexOf(aTaskId);
      const newIdx = taskIds.indexOf(oTaskId);
      if (oldIdx !== -1 && newIdx !== -1) {
        sidebarStore.setTaskOrder(aProjId, arrayMove(taskIds, oldIdx, newIdx));
      }
    }
  }

  function renderOverlayContent(id: string) {
    if (id.startsWith('proj::')) {
      return <SidebarProjectItem projectId={id.slice(6)} />;
    }
    if (id.startsWith('task::')) {
      const [, projId, taskId] = id.split('::');
      return <SidebarTaskItem projectId={projId} taskId={taskId} />;
    }
    return null;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={typeRestrictedCollision}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={allDndIds} strategy={verticalListSortingStrategy}>
        <div ref={scrollRef} className="overflow-y-auto min-h-0 flex-1 px-3 pt-1 pb-3">
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((vItem) => {
              const row = displayRows[vItem.index];
              if (!row) return null;
              const dndId = rowToDndId(row);
              const vStyle: React.CSSProperties = {
                position: 'absolute',
                top: vItem.start,
                left: 0,
                width: '100%',
                height: `${vItem.size}px`,
              };
              if (row.kind === 'project') {
                return (
                  <SortableRow key={row.projectId} dndId={dndId} style={vStyle}>
                    <SidebarProjectItem projectId={row.projectId} />
                  </SortableRow>
                );
              }
              return (
                <SortableRow key={`${row.projectId}:${row.taskId}`} dndId={dndId} style={vStyle}>
                  <SidebarTaskItem projectId={row.projectId} taskId={row.taskId} />
                </SortableRow>
              );
            })}
          </div>
        </div>
      </SortableContext>
      <DragOverlay>
        {activeId ? (
          <div className="px-3">
            <div className="rounded-lg bg-background-tertiary-2 shadow-md">
              {renderOverlayContent(activeId)}
            </div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
});

const toProjectDndId = (id: string) => `proj::${id}`;
const toTaskDndId = (projectId: string, taskId: string) => `task::${projectId}::${taskId}`;

function rowToDndId(row: SidebarRow): string {
  if (row.kind === 'project') return toProjectDndId(row.projectId);
  return toTaskDndId(row.projectId, row.taskId);
}

// Only allow dropping a project onto another project, and a task onto a task
// within the same project. Prevents task rows from becoming drop targets during
// project drags (which would cause the drag to silently no-op in onDragEnd).
const typeRestrictedCollision: CollisionDetection = (args) => {
  const activeId = String(args.active.id);
  const prefix = activeId.startsWith('proj::') ? 'proj::' : `task::${activeId.split('::')[1]}::`;
  return closestCenter({
    ...args,
    droppableContainers: args.droppableContainers.filter((c) => String(c.id).startsWith(prefix)),
  });
};

interface SortableRowProps {
  dndId: string;
  style: React.CSSProperties;
  children: React.ReactNode;
}

function SortableRow({ dndId, style, children }: SortableRowProps) {
  const { setNodeRef, transform, transition, isDragging, listeners, attributes } = useSortable({
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
    <div ref={setNodeRef} style={combinedStyle} {...attributes} {...listeners}>
      {children}
    </div>
  );
}
