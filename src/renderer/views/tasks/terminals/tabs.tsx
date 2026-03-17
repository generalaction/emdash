import { Plus, X } from 'lucide-react';
import { useCallback } from 'react';
import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/lib/utils';
import { useTaskViewContext } from '../task-view-context';

export function TerminalsTabs() {
  const { terminals, activeTerminalId, setActiveTerminalId, createTerminal, removeTerminal } =
    useTaskViewContext();

  const activeId = activeTerminalId ?? terminals[0]?.id ?? '';

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
      if (terminals.length <= 1) return;
      removeTerminal(terminalId);
      if (activeTerminalId === terminalId) {
        const index = terminals.findIndex((t) => t.id === terminalId);
        const nextId = terminals[index + 1]?.id ?? terminals[index - 1]?.id ?? '';
        setActiveTerminalId(nextId);
      }
    },
    [activeTerminalId, terminals, removeTerminal, setActiveTerminalId]
  );

  return (
    <div className="flex items-center justify-between gap-2 p-2">
      <div className="flex gap-1">
        {terminals.map((terminal) => (
          <button
            key={terminal.id}
            onClick={() => setActiveTerminalId(terminal.id)}
            className={cn(
              'group relative flex items-center gap-1.5 rounded-md border border-border px-2 text-sm hover:bg-muted',
              activeId === terminal.id && 'bg-muted'
            )}
          >
            <span className="max-w-24 truncate">{terminal.name}</span>
            {terminals.length > 1 && (
              <Button
                variant="ghost"
                size="icon-xs"
                className="absolute right-0 bg-muted opacity-0 group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemove(terminal.id);
                }}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </button>
        ))}
      </div>
      <Button variant="ghost" size="icon-xs" onClick={handleCreate} title="New terminal">
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
