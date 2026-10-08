import { Select } from '@emdash/ui/react/primitives';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Fragment, useEffect, useState } from 'react';
import { getConversationsForTask } from '@core/features/conversations/api/browser/conversation-selectors';
import { multitaskLayoutMemento } from '@core/features/multitask/contributions/mementos';
import { multitaskViewDef } from '@core/features/multitask/contributions/views';
import { getProjectManagerStore } from '@core/features/projects/api/browser/stores/project-selectors';
import { getTaskManagerStore } from '@core/features/tasks/api/browser/task-state/task-selectors';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { Titlebar } from '@core/features/workbench/contributions/browser/Titlebar';
import { useMemento } from '@core/primitives/mementos/react';
import { useNavigate } from '@core/primitives/navigation/browser/navigation-hooks';
import { useMobileViewport } from '@core/primitives/styling/browser/use-mobile-viewport';
import { registeredTaskData } from '@core/primitives/task-state/browser/task-state';
import { defineViewRuntime } from '@core/primitives/views/react';
import { MultitaskGrid } from './multitask-grid';
import {
  buildKnownCellKeys,
  buildMultitaskGroups,
  clampColumns,
  type MultitaskCell,
  type MultitaskProjectInput,
  pruneMissingCells,
  removeCell,
  reorderCells,
  toggleCell,
} from './multitask-model';
import { MultitaskPicker } from './multitask-picker';

const COLUMN_OPTIONS = [1, 2, 3, 4] as const;

function collectMultitaskProjects(): MultitaskProjectInput[] {
  return [...getProjectManagerStore().projects.values()].map((project) => {
    const manager = getTaskManagerStore(project.id);
    return {
      id: project.id,
      name: project.name ?? project.id,
      tasks: manager
        ? [...manager.tasks.values()].flatMap((task) => {
            const data = registeredTaskData(task);
            if (!data || data.type === 'automation-run') return [];
            const conversations = getConversationsForTask(data.id);
            return [
              {
                id: data.id,
                name: data.name,
                isArchived: !!data.archivedAt,
                conversations: conversations
                  ? [...conversations.conversations.values()].map((conversation) => ({
                      id: conversation.data.id,
                      title: conversation.data.title,
                      providerId: conversation.data.providerId,
                      status: conversation.status,
                    }))
                  : [],
              },
            ];
          })
        : [],
    };
  });
}

export const MultitaskMainPanel = observer(function MultitaskMainPanel() {
  const { navigate } = useNavigate();
  const isMobile = useMobileViewport();
  const [pickerOpen, setPickerOpen] = useState(true);
  const [layout, setLayout] = useMemento(multitaskLayoutMemento);

  const projects = collectMultitaskProjects();
  const groups = buildMultitaskGroups(projects, { liveOnly: layout.liveOnly });
  const knownKeys = buildKnownCellKeys(projects);

  // Drop selections pointing at a task or conversation that was deleted.
  // Cells that merely stopped being "live" are left alone — only the close
  // button in the grid removes those.
  useEffect(() => {
    const pruned = pruneMissingCells(layout.cells, knownKeys);
    if (pruned.length !== layout.cells.length) {
      setLayout((current) => ({ ...current, cells: pruned }));
    }
  }, [knownKeys, layout.cells, setLayout]);

  const columns = isMobile ? 1 : clampColumns(layout.columns);

  const handleToggleCell = (cell: MultitaskCell) =>
    setLayout((current) => ({ ...current, cells: toggleCell(current.cells, cell) }));
  const handleRemoveCell = (cell: MultitaskCell) =>
    setLayout((current) => ({ ...current, cells: removeCell(current.cells, cell) }));
  const handleReorder = (fromIndex: number, toIndex: number) =>
    setLayout((current) => ({
      ...current,
      cells: reorderCells(current.cells, fromIndex, toIndex),
    }));
  const handleLiveOnlyChange = (liveOnly: boolean) =>
    setLayout((current) => ({ ...current, liveOnly }));
  const handleColumnsChange = (next: number) =>
    setLayout((current) => ({ ...current, columns: clampColumns(next) }));
  const handleOpenCell = (cell: MultitaskCell) =>
    navigate(taskViewDef({ projectId: cell.projectId, taskId: cell.taskId }));

  const showPicker = pickerOpen && !isMobile;

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <MultitaskToolbar
        pickerOpen={pickerOpen}
        onTogglePicker={() => setPickerOpen((open) => !open)}
        columns={layout.columns}
        onColumnsChange={handleColumnsChange}
        hideColumns={isMobile}
      />
      <div className="flex min-h-0 flex-1">
        {showPicker && (
          <aside className="flex h-full w-72 shrink-0 flex-col border-r border-border bg-background-1">
            <MultitaskPicker
              groups={groups}
              selectedCells={layout.cells}
              liveOnly={layout.liveOnly}
              onLiveOnlyChange={handleLiveOnlyChange}
              onToggleCell={handleToggleCell}
            />
          </aside>
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {isMobile && pickerOpen && (
            <div className="max-h-64 shrink-0 overflow-y-auto border-b border-border">
              <MultitaskPicker
                groups={groups}
                selectedCells={layout.cells}
                liveOnly={layout.liveOnly}
                onLiveOnlyChange={handleLiveOnlyChange}
                onToggleCell={handleToggleCell}
              />
            </div>
          )}
          <div className="min-h-0 flex-1">
            <MultitaskGrid
              cells={layout.cells}
              columns={columns}
              onReorder={handleReorder}
              onRemove={handleRemoveCell}
              onOpen={handleOpenCell}
            />
          </div>
        </div>
      </div>
    </div>
  );
});

function MultitaskToolbar({
  pickerOpen,
  onTogglePicker,
  columns,
  onColumnsChange,
  hideColumns,
}: {
  pickerOpen: boolean;
  onTogglePicker: () => void;
  columns: number;
  onColumnsChange: (columns: number) => void;
  hideColumns: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
      <button
        type="button"
        onClick={onTogglePicker}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-foreground-muted transition-colors hover:bg-background-2"
      >
        {pickerOpen ? (
          <PanelLeftClose className="size-3.5" />
        ) : (
          <PanelLeftOpen className="size-3.5" />
        )}
        Chats
      </button>
      {!hideColumns && (
        <label className="flex items-center gap-2 text-xs text-foreground-muted">
          Columnas
          <Select.Root
            value={String(clampColumnsForSelect(columns))}
            onValueChange={(value) => onColumnsChange(Number(value))}
          >
            <Select.Trigger size="sm" className="min-w-14">
              <Select.Value />
            </Select.Trigger>
            <Select.Content align="end">
              {COLUMN_OPTIONS.map((option) => (
                <Select.Item key={option} value={String(option)}>
                  {option}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </label>
      )}
    </div>
  );
}

function clampColumnsForSelect(columns: number): number {
  return COLUMN_OPTIONS.includes(columns as (typeof COLUMN_OPTIONS)[number]) ? columns : 2;
}

function MultitaskTitlebar() {
  return <Titlebar leftSlot={<span className="px-2 text-sm">Multitarea</span>} />;
}

export const multitaskViewRuntime = defineViewRuntime(multitaskViewDef, {
  slots: {
    wrap: Fragment,
    titlebar: MultitaskTitlebar,
    main: MultitaskMainPanel,
  },
});
