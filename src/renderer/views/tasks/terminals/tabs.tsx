import { FileTerminal, Play, Plus, Terminal, X } from 'lucide-react';
import { useCallback } from 'react';
import { Button } from '@renderer/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip';
import { cn } from '@renderer/lib/utils';
import type { TerminalTabItem } from '../hooks/use-terminals';
import { useTaskViewContext } from '../task-view-context';

interface TerminalsTabsProps {
  tabItems: TerminalTabItem[];
  activeId: string | null;
}

export function TerminalsTabs({ tabItems, activeId }: TerminalsTabsProps) {
  const { setActiveTerminalId, createTerminal, removeTerminal, runLifecycleScript } =
    useTaskViewContext();

  const activeItem = tabItems.find((item) => item.id === activeId) ?? null;

  const handleCreate = useCallback(async () => {
    try {
      const terminal = await createTerminal();
      setActiveTerminalId(terminal.id);
    } catch (error) {
      console.error('Failed to create terminal:', error);
    }
  }, [createTerminal, setActiveTerminalId]);

  const handleRemove = useCallback(
    (terminalId: string) => {
      removeTerminal(terminalId);
      if (activeId === terminalId) {
        const index = tabItems.findIndex((item) => item.id === terminalId);
        const nextId = tabItems[index + 1]?.id ?? tabItems[index - 1]?.id;
        setActiveTerminalId(nextId ?? undefined);
      }
    },
    [activeId, tabItems, removeTerminal, setActiveTerminalId]
  );

  return (
    <div>
      <div className="flex items-center justify-between gap-2 p-2">
        <div className="flex gap-1">
          {tabItems.map((item) => {
            const isActive = activeId === item.id;
            if (item.kind === 'lifecycle') {
              return (
                <Tooltip key={item.type}>
                  <TooltipTrigger>
                    <button
                      onClick={() => setActiveTerminalId(item.id)}
                      className={cn(
                        'group relative flex items-center gap-1.5 rounded-md border border-border px-2.5 h-7 justify-center hover:bg-muted text-xs',
                        isActive && 'bg-muted'
                      )}
                    >
                      <FileTerminal className="size-3" />
                      <span className="capitalize">{item.type}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="capitalize">{item.type} script</TooltipContent>
                </Tooltip>
              );
            }

            return (
              <button
                key={item.id}
                onClick={() => setActiveTerminalId(item.id)}
                className={cn(
                  'group relative flex items-center gap-1.5 rounded-md border border-border h-7 px-2.5 text-xs hover:bg-muted',
                  isActive && 'bg-muted'
                )}
              >
                <Terminal className="size-3" />
                <span className="max-w-24 truncate">{item.name}</span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="absolute right-0 bg-muted opacity-0 group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemove(item.id);
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </button>
            );
          })}
        </div>
        <Button
          variant="outline"
          className="size-7"
          size="icon-xs"
          onClick={handleCreate}
          title="New terminal"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      {activeItem?.kind === 'lifecycle' && (
        <div className="p-2 pt-0">
          <div className="flex items-center gap-2 p-1.5 justify-between border border-border rounded-lg">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon-xs"
                onClick={() => runLifecycleScript(activeItem.type)}
              >
                <Play className="size-3" />
              </Button>
              <span className="text-xs text-muted-foreground capitalize">
                {activeItem.type} script
              </span>
            </div>
            <button
              className="text-xs text-muted-foreground hover:text-foreground mr-1"
              onClick={() => {}}
            >
              View in Project Settings
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
