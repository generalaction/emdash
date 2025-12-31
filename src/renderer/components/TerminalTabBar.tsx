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
    <div className="relative flex h-[var(--tb,48px)] shrink-0 items-center border-b border-black/[0.06] bg-white/60 px-3 backdrop-blur-md dark:border-white/[0.06] dark:bg-gray-900/60">
      <div className="flex min-w-0 flex-1 items-center overflow-x-auto">
        {terminals.map((terminal, index) => {
          const isActive = terminal.id === activeTerminalId;
          return (
            <button
              key={terminal.id}
              type="button"
              onClick={() => onSelectTerminal(terminal.id)}
              className={cn(
                'group relative flex h-[var(--tb,48px)] items-center gap-2 px-4 text-[13px] font-medium transition-colors',
                isActive
                  ? 'text-gray-900 dark:text-white'
                  : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              )}
            >
              <span
                className={cn(
                  'h-2 w-2 shrink-0 rounded-full',
                  isActive ? 'bg-orange-500' : 'bg-gray-300 dark:bg-gray-600'
                )}
              />
              <span className="truncate">{terminal.title}</span>
              {isActive && (
                <div className="absolute bottom-0 left-4 right-4 h-[2px] bg-orange-500" />
              )}
            </button>
          );
        })}
        <button
          type="button"
          onClick={onCreateTerminal}
          className="flex h-[var(--tb,48px)] w-10 shrink-0 items-center justify-center text-gray-400 transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
          aria-label="New session"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

export default TerminalTabBar;
