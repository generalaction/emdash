import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { MicroLabel } from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import { pinKey } from '@core/features/workbench/browser/sidebar/sidebar-store';
import { getSidebarStore } from '@core/features/workbench/contributions/browser/app-stores';
import { SidebarGroup, SidebarMenu } from './sidebar-primitives';
import { SidebarTaskItem } from './task-item';

export const SidebarPinnedTaskList = observer(function SidebarPinnedTaskList() {
  const sidebar = getSidebarStore();
  const entries = sidebar.pinnedSidebarEntries;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  if (entries.length === 0) return null;

  const ids = entries.map(({ projectId, taskId }) => pinKey(projectId, taskId));

  // Pinned tasks reorder only among each other; the project list is a separate list.
  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    sidebar.setPinnedOrder(arrayMove(entries, from, to));
  }

  return (
    <SidebarGroup className="flex shrink-0 flex-col">
      <div className="flex h-[40px] items-center justify-between pr-2.5 pl-5">
        <MicroLabel className="font-medium text-foreground-tertiary-passive">Pinned</MicroLabel>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <SidebarMenu className="px-3 pb-2">
            {entries.map(({ projectId, taskId }) => (
              <SortablePinnedRow key={pinKey(projectId, taskId)} id={pinKey(projectId, taskId)}>
                <SidebarTaskItem projectId={projectId} taskId={taskId} rowVariant="pinned" />
              </SortablePinnedRow>
            ))}
          </SidebarMenu>
        </SortableContext>
      </DndContext>
    </SidebarGroup>
  );
});

function SortablePinnedRow({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, transform, transition, isDragging, listeners } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{
        // Vertical only: the row follows the pointer up and down within the list.
        transform: CSS.Transform.toString(transform && { ...transform, x: 0 }),
        transition,
        opacity: isDragging ? 0.6 : 1,
        position: 'relative',
        zIndex: isDragging ? 1 : 'auto',
      }}
      {...listeners}
    >
      {children}
    </div>
  );
}
