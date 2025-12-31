import React from 'react';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TaskTerminal } from '@/lib/taskTerminalsStore';

interface TerminalTabBarProps {
  terminals: TaskTerminal[];
  activeTerminalId: string | null;
  onSelectTerminal: (id: string) => void;
  onCreateTerminal: () => void;
  onCloseTerminal: (id: string) => void;
}

const TerminalTabBar: React.FC<TerminalTabBarProps> = ({
  terminals,
  activeTerminalId,
  onSelectTerminal,
  onCreateTerminal,
  onCloseTerminal,
}) => {
  return (
    <div className="navbar border-border">
      <div className="flex min-w-0 flex-1 items-center overflow-x-auto">
        {terminals.map((terminal) => {
          const isActive = terminal.id === activeTerminalId;
          return (
            <button
              key={terminal.id}
              type="button"
              onClick={() => onSelectTerminal(terminal.id)}
              className="navbar-tab"
              data-active={isActive}
            >
              <span className="navbar-tab-dot" data-active={isActive} />
              <span className="truncate">{terminal.title}</span>
              {isActive && <div className="navbar-tab-indicator" />}
            </button>
          );
        })}
        <button
          type="button"
          onClick={onCreateTerminal}
          className="flex h-12 w-10 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
          aria-label="New session"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

export default TerminalTabBar;
