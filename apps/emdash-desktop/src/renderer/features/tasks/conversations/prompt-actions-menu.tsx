import { ArrowUp, ChevronDown, ChevronUp, FileSearch } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import type { ContextAction, PromptContextAction } from './context-actions';

const EXPAND_TEXT_LENGTH = 140;

function previewStyle(expanded: boolean): CSSProperties {
  if (expanded) return {};

  return {
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 2,
    overflow: 'hidden',
  };
}

export function PromptActionsMenu({
  actions,
  disabled,
  disabledTooltip,
  actionTooltip,
  onActionClick,
}: {
  actions: PromptContextAction[];
  disabled?: boolean;
  disabledTooltip: string;
  actionTooltip: string;
  onActionClick: (action: ContextAction) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  if (actions.length === 0) return null;

  const handleActionClick = (action: ContextAction) => {
    void onActionClick(action);
    setOpen(false);
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              disabled={disabled}
              className="relative flex h-7 max-w-full items-center gap-1.5 self-center rounded-md border border-border bg-background-1 px-2 text-xs font-normal text-foreground hover:bg-background-1/80 disabled:pointer-events-none disabled:opacity-50"
            >
              <FileSearch className="size-3.5 shrink-0" />
              <span className="max-w-72 truncate">Prompts</span>
              <ChevronDown className="size-3 shrink-0" />
            </PopoverTrigger>
          }
        />
        <TooltipContent>{disabled ? disabledTooltip : actionTooltip}</TooltipContent>
      </Tooltip>

      <PopoverContent
        align="start"
        className="max-h-[min(var(--available-height),420px,80vh)] w-[min(420px,92vw)] gap-0 p-0"
      >
        <div className="shrink-0 border-b px-4 py-3">
          <div className="text-sm font-semibold">Prompts</div>
          <div className="text-muted-foreground text-xs">{actionTooltip}</div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          {actions.map((action) => {
            const canExpand = action.prompt.prompt.length > EXPAND_TEXT_LENGTH;
            const expanded = expandedIds.has(action.id);
            return (
              <div
                key={action.id}
                className="flex items-start gap-2 rounded-md px-3 py-2 transition-colors focus-within:bg-background-1 hover:bg-background-1"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left focus:outline-none"
                  onClick={() => handleActionClick(action)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-foreground">
                      {action.prompt.title}
                    </span>
                    <span
                      className={
                        expanded
                          ? 'text-muted-foreground mt-0.5 block max-h-48 overflow-y-auto pr-1 text-xs leading-relaxed'
                          : 'text-muted-foreground mt-0.5 block text-xs leading-relaxed'
                      }
                      style={previewStyle(expanded)}
                    >
                      {action.prompt.prompt}
                    </span>
                  </span>
                </button>
                <div className="mt-0.5 flex shrink-0 items-center gap-0.5">
                  {canExpand ? (
                    <button
                      type="button"
                      className="rounded-sm p-1 text-foreground-muted hover:bg-background-2 hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-foreground/30"
                      onClick={() => toggleExpanded(action.id)}
                      aria-label={`${expanded ? 'Collapse' : 'Expand'} ${action.prompt.title}`}
                    >
                      {expanded ? (
                        <ChevronUp className="size-3.5" />
                      ) : (
                        <ChevronDown className="size-3.5" />
                      )}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="rounded-sm p-1 text-foreground-muted hover:bg-background-2 hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-foreground/30"
                    onClick={() => handleActionClick(action)}
                    aria-label={`Add ${action.prompt.title}`}
                  >
                    <ArrowUp className="size-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
