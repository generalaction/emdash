import React, { useMemo } from 'react';
import { TerminalPane } from './TerminalPane';
import { Bot, Terminal, Plus, X } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { useWorkspaceTerminals } from '@/lib/workspaceTerminalsStore';
import { cn } from '@/lib/utils';

interface Workspace {
  id: string;
  name: string;
  branch: string;
  path: string;
  status: 'active' | 'idle' | 'running';
}

interface Props {
  workspace: Workspace | null;
  className?: string;
}

const WorkspaceTerminalPanelComponent: React.FC<Props> = ({ workspace, className }) => {
  const { effectiveTheme } = useTheme();
  const {
    terminals,
    activeTerminalId,
    activeTerminal,
    createTerminal,
    setActiveTerminal,
    closeTerminal,
  } = useWorkspaceTerminals(workspace?.id ?? null, workspace?.path);

  const themeOverride = useMemo(
    () =>
      effectiveTheme === 'dark'
        ? {
            background: '#1f2937',
            foreground: '#ffffff',
            cursor: '#ffffff',
            selectionBackground: '#ffffff33',
            black: '#1f2937',
            red: '#ffffff',
            green: '#ffffff',
            yellow: '#ffffff',
            blue: '#ffffff',
            magenta: '#ffffff',
            cyan: '#ffffff',
            white: '#ffffff',
            brightBlack: '#ffffff',
            brightRed: '#ffffff',
            brightGreen: '#ffffff',
            brightYellow: '#ffffff',
            brightBlue: '#ffffff',
            brightMagenta: '#ffffff',
            brightCyan: '#ffffff',
            brightWhite: '#ffffff',
          }
        : {
            background: '#ffffff',
            foreground: '#000000',
            cursor: '#000000',
            selectionBackground: '#00000033',
            black: '#ffffff',
            red: '#000000',
            green: '#000000',
            yellow: '#000000',
            blue: '#000000',
            magenta: '#000000',
            cyan: '#000000',
            white: '#000000',
            brightBlack: '#000000',
            brightRed: '#000000',
            brightGreen: '#000000',
            brightYellow: '#000000',
            brightBlue: '#000000',
            brightMagenta: '#000000',
            brightCyan: '#000000',
            brightWhite: '#000000',
          },
    [effectiveTheme]
  );

  if (!workspace) {
    return (
      <div
        className={`flex h-full flex-col items-center justify-center bg-gray-50 dark:bg-gray-900 ${className}`}
      >
        <Bot className="mb-2 h-8 w-8 text-gray-400" />
        <h3 className="mb-1 text-sm text-gray-600 dark:text-gray-400">No Workspace Selected</h3>
        <p className="text-center text-xs text-gray-500 dark:text-gray-500">
          Select a workspace to view its terminal
        </p>
      </div>
    );
  }

  return (
    <div className={cn('flex h-full flex-col bg-white dark:bg-gray-800', className)}>
      <div className="flex items-center border-b border-border bg-gray-50 px-2 py-1.5 dark:bg-gray-900">
        <div className="flex min-w-0 flex-1 items-center space-x-1 overflow-x-auto">
          {terminals.map((terminal) => {
            const isActive = terminal.id === activeTerminalId;
            return (
              <button
                key={terminal.id}
                type="button"
                onClick={() => setActiveTerminal(terminal.id)}
                className={cn(
                  'group flex items-center space-x-1 rounded px-2 py-1 text-xs font-medium transition-colors',
                  isActive
                    ? 'bg-background text-foreground shadow-sm dark:bg-gray-800 dark:text-gray-50'
                    : 'text-muted-foreground hover:bg-background/70 dark:hover:bg-gray-800'
                )}
                title={terminal.title}
              >
                <Terminal className="h-3.5 w-3.5 shrink-0" />
                <span className="max-w-[130px] truncate">{terminal.title}</span>
                {terminals.length > 1 ? (
                  <span
                    role="button"
                    tabIndex={-1}
                    onClick={(event) => {
                      event.stopPropagation();
                      closeTerminal(terminal.id);
                    }}
                    className="flex h-4 w-4 items-center justify-center rounded opacity-60 transition-opacity hover:bg-muted hover:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => createTerminal()}
          className="ml-2 flex h-6 w-6 items-center justify-center rounded border border-transparent text-muted-foreground transition hover:border-border hover:bg-background dark:hover:bg-gray-800"
          title="New terminal"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <div
        className={cn(
          'bw-terminal relative flex-1 overflow-hidden',
          effectiveTheme === 'dark' ? 'bg-gray-800' : 'bg-white'
        )}
      >
        {terminals.map((terminal) => (
          <div
            key={terminal.id}
            className={cn(
              'absolute inset-0 h-full w-full transition-opacity',
              terminal.id === activeTerminalId ? 'opacity-100' : 'pointer-events-none opacity-0'
            )}
          >
            <TerminalPane
              id={terminal.id}
              cwd={terminal.cwd || workspace.path}
              variant={effectiveTheme === 'dark' ? 'dark' : 'light'}
              themeOverride={themeOverride}
              className="h-full w-full"
              keepAlive
            />
          </div>
        ))}
        {!terminals.length || !activeTerminal ? (
          <div className="flex h-full flex-col items-center justify-center text-xs text-muted-foreground">
            <p>No terminal found.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
};
export const WorkspaceTerminalPanel = React.memo(WorkspaceTerminalPanelComponent);

export default WorkspaceTerminalPanel;
