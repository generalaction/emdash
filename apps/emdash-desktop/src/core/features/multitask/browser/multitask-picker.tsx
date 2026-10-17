import { AgentStatus } from '@emdash/ui/react/components';
import { Badge, Checkbox, Switch } from '@emdash/ui/react/primitives';
import { X } from 'lucide-react';
import { cn } from '@core/primitives/styling/browser/cn';
import {
  cellKey,
  hasCell,
  type MultitaskCell,
  type MultitaskProjectGroup,
} from './multitask-model';

export function MultitaskPicker({
  groups,
  selectedCells,
  liveOnly,
  onLiveOnlyChange,
  onToggleCell,
}: {
  groups: readonly MultitaskProjectGroup[];
  selectedCells: readonly MultitaskCell[];
  liveOnly: boolean;
  onLiveOnlyChange: (liveOnly: boolean) => void;
  onToggleCell: (cell: MultitaskCell) => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <span className="text-xs font-medium text-foreground-muted">Chats</span>
        <label className="flex items-center gap-2 text-xs text-foreground-muted">
          Solo en vivo
          <Switch
            checked={liveOnly}
            onCheckedChange={(checked) => onLiveOnlyChange(checked === true)}
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {groups.length === 0 ? (
          <p className="px-3 py-5 text-center text-sm text-foreground-muted">
            {liveOnly ? 'Ningún agente corriendo ahora.' : 'No hay chats disponibles.'}
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.id} className="border-b border-border last:border-b-0">
              <div className="px-3 py-2 text-xs font-medium text-foreground-muted">
                {group.name}
              </div>
              {group.tasks.map((task) => (
                <div key={task.id} className="px-1 pb-1.5">
                  <div className="truncate px-2 py-1 text-xs text-foreground-passive">
                    {task.name}
                  </div>
                  {task.conversations.map((conversation) => {
                    const cell: MultitaskCell = {
                      projectId: group.id,
                      taskId: task.id,
                      conversationId: conversation.id,
                    };
                    const selected = hasCell(selectedCells, cell);
                    return (
                      <label
                        key={cellKey(cell)}
                        className={cn(
                          'flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-background-2',
                          selected && 'bg-background-2'
                        )}
                      >
                        <Checkbox checked={selected} onCheckedChange={() => onToggleCell(cell)} />
                        <AgentStatus status={conversation.isLive ? conversation.status : null} />
                        <span className="min-w-0 flex-1 truncate text-sm">
                          {conversation.title || conversation.providerId}
                        </span>
                        {!conversation.isLive && (
                          <Badge variant="outline" className="shrink-0">
                            inactivo
                          </Badge>
                        )}
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function MultitaskPickerToggle({
  open,
  onToggle,
  selectedCount,
}: {
  open: boolean;
  onToggle: () => void;
  selectedCount: number;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-foreground-muted transition-colors hover:bg-background-2"
    >
      {open ? <X className="size-3.5" /> : null}
      {open ? 'Ocultar chats' : `Chats (${selectedCount})`}
    </button>
  );
}
