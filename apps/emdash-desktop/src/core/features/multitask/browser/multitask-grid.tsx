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
import { GripVertical, Maximize2, Minimize2, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
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
import { cellKey, type MultitaskCell } from './multitask-model';

export function MultitaskGrid({
  cells,
  columns,
  minimizedCellKeys,
  attentionCellKeys,
  onReorder,
  onRemove,
  onOpen,
  onMinimize,
  onRestore,
}: {
  cells: readonly MultitaskCell[];
  columns: number;
  minimizedCellKeys: readonly string[];
  attentionCellKeys: readonly string[];
  onReorder: (fromIndex: number, toIndex: number) => void;
  onRemove: (cell: MultitaskCell) => void;
  onOpen: (cell: MultitaskCell) => void;
  onMinimize: (cell: MultitaskCell) => void;
  onRestore: (cell: MultitaskCell) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const minimized = new Set(minimizedCellKeys);
  const visibleCells = cells.filter((cell) => !minimized.has(cellKey(cell)));
  const ids = visibleCells.map((cell) => cellKey(cell));

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
    const fromIndex = cells.findIndex((cell) => cellKey(cell) === String(active.id));
    const toIndex = cells.findIndex((cell) => cellKey(cell) === String(over.id));
    if (fromIndex === -1 || toIndex === -1) return;
    onReorder(fromIndex, toIndex);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-background-1 px-2 pt-1.5">
        {cells.map((cell) => (
          <MultitaskTab
            key={cellKey(cell)}
            cell={cell}
            minimized={minimized.has(cellKey(cell))}
            attention={attentionCellKeys.includes(cellKey(cell))}
            onRestore={onRestore}
          />
        ))}
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={rectSortingStrategy}>
          <div className="flex min-h-0 flex-1 flex-wrap content-start items-start gap-2 overflow-auto p-2">
            {visibleCells.length === 0 ? (
              <EmptyState bare label="Chats minimizados" description="Elegí un tab para restaurarlo." />
            ) : (
              visibleCells.map((cell) => (
                <div
                  key={cellKey(cell)}
                  className="min-h-64 min-w-72 shrink-0 resize overflow-auto"
                  style={{
                    width: `calc((100% - ${(columns - 1) * 8}px) / ${columns})`,
                    height: visibleCells.length <= columns ? '100%' : '28rem',
                  }}
                >
                  <MultitaskGridCell
                    cell={cell}
                    onRemove={onRemove}
                    onOpen={onOpen}
                    onMinimize={onMinimize}
                  />
                </div>
              ))
            )}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

const MultitaskTab = observer(function MultitaskTab({
  cell,
  minimized,
  attention,
  onRestore,
}: {
  cell: MultitaskCell;
  minimized: boolean;
  attention: boolean;
  onRestore: (cell: MultitaskCell) => void;
}) {
  const conversation = getConversationsForTask(cell.taskId)?.conversations.get(cell.conversationId);
  const title = conversation
    ? formatConversationTitleForDisplay(conversation.data.providerId, conversation.data.title)
    : 'Chat';

  return (
    <button
      type="button"
      onClick={() => onRestore(cell)}
      aria-label={`${minimized ? 'Restaurar' : 'Ver'} ${title}`}
      className={`flex max-w-56 shrink-0 items-center gap-1.5 rounded-t-md border border-b-0 px-2.5 py-1.5 text-xs transition-colors ${
        minimized
          ? 'border-border bg-background-2 text-foreground-muted hover:text-foreground'
          : 'border-border bg-background text-foreground'
      } ${attention ? 'animate-pulse ring-1 ring-success' : ''}`}
    >
      {conversation && <AgentStatus status={conversation.indicatorStatus} />}
      <span className="truncate">{title}</span>
    </button>
  );
});

const MultitaskGridCell = observer(function MultitaskGridCell({
  cell,
  onRemove,
  onOpen,
  onMinimize,
}: {
  cell: MultitaskCell;
  onRemove: (cell: MultitaskCell) => void;
  onOpen: (cell: MultitaskCell) => void;
  onMinimize: (cell: MultitaskCell) => void;
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
          onClick={() => onMinimize(cell)}
          aria-label="Minimizar"
          className="shrink-0 rounded p-1 text-foreground-passive hover:bg-background-2 hover:text-foreground"
        >
          <Minimize2 className="size-3.5" />
        </button>
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
