import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { rectSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AgentStatus, EmptyState } from '@emdash/ui/react/components';
import { Resizable } from '@emdash/ui/react/primitives';
import { GripVertical, Maximize2, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Fragment } from 'react';
import { getConversationsForTask } from '@core/features/conversations/api/browser/conversation-selectors';
import { formatConversationTitleForDisplay } from '@core/features/conversations/api/browser/conversation-title-utils';
import {
  getProjectStore,
  projectDisplayName,
} from '@core/features/projects/api/browser/stores/project-selectors';
import {
  getTaskStore,
  taskDisplayName,
} from '@core/features/tasks/api/browser/task-state/task-selectors';
import { MultitaskCellChat } from './multitask-cell';
import { cellKey, chunkIntoRows, type MultitaskCell } from './multitask-model';

export function MultitaskGrid({
  cells,
  columns,
  onReorder,
  onRemove,
  onOpen,
}: {
  cells: readonly MultitaskCell[];
  columns: number;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onRemove: (cell: MultitaskCell) => void;
  onOpen: (cell: MultitaskCell) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const ids = cells.map((cell) => cellKey(cell));

  if (cells.length === 0) {
    return (
      <EmptyState
        bare
        label="Multitarea"
        description="Seleccioná chats a la izquierda para verlos acá en simultáneo."
      />
    );
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIndex = ids.indexOf(String(active.id));
    const toIndex = ids.indexOf(String(over.id));
    if (fromIndex === -1 || toIndex === -1) return;
    onReorder(fromIndex, toIndex);
  }

  const rows = chunkIntoRows(cells, columns);

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <Resizable.Group orientation="vertical" id="multitask-rows" className="h-full w-full p-2">
          {rows.map((row, rowIndex) => (
            <Fragment key={rowIndex}>
              {rowIndex > 0 && <Resizable.Handle />}
              <Resizable.Panel
                id={`multitask-row-${rowIndex}`}
                defaultSize={`${100 / rows.length}%`}
                minSize="10%"
              >
                <Resizable.Group
                  orientation="horizontal"
                  id={`multitask-row-${rowIndex}-cols`}
                  className="h-full w-full gap-2"
                >
                  {row.map((cell, cellIndex) => (
                    <Fragment key={cellKey(cell)}>
                      {cellIndex > 0 && <Resizable.Handle />}
                      <Resizable.Panel
                        id={`multitask-cell-${cellKey(cell)}`}
                        defaultSize={`${100 / row.length}%`}
                        minSize="10%"
                      >
                        <MultitaskGridCell cell={cell} onRemove={onRemove} onOpen={onOpen} />
                      </Resizable.Panel>
                    </Fragment>
                  ))}
                </Resizable.Group>
              </Resizable.Panel>
            </Fragment>
          ))}
        </Resizable.Group>
      </SortableContext>
    </DndContext>
  );
}

const MultitaskGridCell = observer(function MultitaskGridCell({
  cell,
  onRemove,
  onOpen,
}: {
  cell: MultitaskCell;
  onRemove: (cell: MultitaskCell) => void;
  onOpen: (cell: MultitaskCell) => void;
}) {
  const { setNodeRef, transform, transition, isDragging, listeners, attributes } = useSortable({
    id: cellKey(cell),
  });
  const conversation = getConversationsForTask(cell.taskId)?.conversations.get(cell.conversationId);
  const title = conversation
    ? formatConversationTitleForDisplay(conversation.data.providerId, conversation.data.title)
    : 'Chat';
  const projectName = projectDisplayName(getProjectStore(cell.projectId)) ?? cell.projectId;
  const taskName = taskDisplayName(getTaskStore(cell.projectId, cell.taskId)) ?? cell.taskId;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 10 : undefined,
      }}
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-background-1"
    >
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-1.5">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="Reordenar"
          className="cursor-grab touch-none text-foreground-passive hover:text-foreground-muted"
        >
          <GripVertical className="size-3.5" />
        </button>
        {conversation && <AgentStatus status={conversation.indicatorStatus} />}
        <span className="min-w-0 flex-1 truncate text-xs text-foreground-muted">
          {projectName} · {taskName} · {title}
        </span>
        <button
          type="button"
          onClick={() => onOpen(cell)}
          aria-label="Abrir"
          className="shrink-0 rounded p-1 text-foreground-passive hover:bg-background-2 hover:text-foreground"
        >
          <Maximize2 className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onRemove(cell)}
          aria-label="Quitar"
          className="shrink-0 rounded p-1 text-foreground-passive hover:bg-background-2 hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <MultitaskCellChat
          projectId={cell.projectId}
          taskId={cell.taskId}
          conversationId={cell.conversationId}
        />
      </div>
    </div>
  );
});
