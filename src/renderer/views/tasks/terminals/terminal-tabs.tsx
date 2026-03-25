import { Plus, Terminal, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback } from 'react';
import { makePtySessionId } from '@shared/ptySessionId';
import { Button } from '@renderer/components/ui/button';
import { getPaneContainer } from '@renderer/core/pty/pane-sizing-context';
import { frontendPtyRegistry } from '@renderer/core/pty/pty';
import { measureDimensions } from '@renderer/core/pty/pty-dimensions';
import { TerminalManagerStore } from '@renderer/core/stores/terminal-manager';
import { cn } from '@renderer/lib/utils';

export type TerminalTabItem = { kind: 'terminal'; id: string; name: string };

function getTerminalsPaneSize() {
  const container = getPaneContainer('terminals');
  return container ? (measureDimensions(container, 8, 16) ?? undefined) : undefined;
}

function nextTerminalName(names: string[]): string {
  const taken = new Set(
    names
      .map((n) => /^Terminal (\d+)$/.exec(n)?.[1])
      .filter(Boolean)
      .map(Number)
  );
  let n = 1;
  while (taken.has(n)) n++;
  return `Terminal ${n}`;
}

interface TerminalsTabsProps {
  tabItems: TerminalTabItem[];
  activeId: string | null;
  projectId: string;
  taskId: string;
  terminalMgr: TerminalManagerStore | null;
}

export const TerminalsTabs = observer(function TerminalsTabs({
  tabItems,
  activeId,
  projectId,
  taskId,
  terminalMgr,
}: TerminalsTabsProps) {
  const handleCreate = useCallback(async () => {
    if (!terminalMgr) return;
    const id = crypto.randomUUID();
    const name = nextTerminalName(tabItems.map((t) => t.name));
    try {
      await terminalMgr.createTerminal({
        id,
        projectId,
        taskId,
        name,
        initialSize: getTerminalsPaneSize(),
      });
    } catch (error) {
      console.error('Failed to create terminal:', error);
    }
  }, [terminalMgr, projectId, taskId, tabItems]);

  const handleRemove = useCallback(
    (terminalId: string) => {
      if (!terminalMgr) return;
      frontendPtyRegistry.unregister(makePtySessionId(projectId, taskId, terminalId));
      void terminalMgr.deleteTerminal(terminalId);
      if (activeId === terminalId) {
        const index = tabItems.findIndex((item) => item.id === terminalId);
        const nextId = tabItems[index + 1]?.id ?? tabItems[index - 1]?.id;
        if (nextId) terminalMgr.tabs.setActiveTab(nextId);
      }
    },
    [activeId, tabItems, terminalMgr, projectId, taskId]
  );

  return (
    <div>
      <div className="flex items-center justify-between gap-2 p-2">
        <div className="flex gap-1">
          {tabItems.map((item) => {
            const isActive = activeId === item.id;
            return (
              <button
                key={item.id}
                onClick={() => terminalMgr?.tabs.setActiveTab(item.id)}
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
    </div>
  );
});
