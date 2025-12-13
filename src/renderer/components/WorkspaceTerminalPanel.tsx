import React, { useMemo, useState, useEffect } from 'react';
import { TerminalPane } from './TerminalPane';
import { Bot, Terminal, Plus, X } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { useWorkspaceTerminals } from '@/lib/workspaceTerminalsStore';
import { cn } from '@/lib/utils';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';
import type { Provider } from '../types';

interface Workspace {
  id: string;
  name: string;
  branch: string;
  path: string;
  status: 'active' | 'idle' | 'running';
}

interface Props {
  workspace: Workspace | null;
  provider?: Provider;
  className?: string;
  projectPath?: string;
}

const WorkspaceTerminalPanelComponent: React.FC<Props> = ({
  workspace,
  provider,
  className,
  projectPath,
}) => {
  const { effectiveTheme } = useTheme();
  const workspaceKey = workspace?.id ?? 'workspace-placeholder';
  const workspaceTerminals = useWorkspaceTerminals(workspaceKey, workspace?.path);
  const globalTerminals = useWorkspaceTerminals('global', projectPath, { defaultCwd: projectPath });
  const [mode, setMode] = useState<'workspace' | 'global'>(workspace ? 'workspace' : 'global');
  useEffect(() => {
    if (!workspace && mode === 'workspace') {
      setMode('global');
    }
  }, [workspace, mode]);

  const {
    terminals,
    activeTerminalId,
    activeTerminal,
    createTerminal,
    setActiveTerminal,
    closeTerminal,
  } = mode === 'global' ? globalTerminals : workspaceTerminals;

  const [nativeTheme, setNativeTheme] = useState<{
    background?: string;
    foreground?: string;
    cursor?: string;
    cursorAccent?: string;
    selectionBackground?: string;
    black?: string;
    red?: string;
    green?: string;
    yellow?: string;
    blue?: string;
    magenta?: string;
    cyan?: string;
    white?: string;
    brightBlack?: string;
    brightRed?: string;
    brightGreen?: string;
    brightYellow?: string;
    brightBlue?: string;
    brightMagenta?: string;
    brightCyan?: string;
    brightWhite?: string;
  } | null>(null);

  // Fetch native terminal theme on mount
  useEffect(() => {
    void (async () => {
      try {
        const result = await window.electronAPI.terminalGetTheme();
        if (result?.ok && result.config?.theme) {
          setNativeTheme(result.config.theme);
        }
      } catch (error) {
        // Silently fail - fall back to default theme
        console.warn('Failed to load native terminal theme', error);
      }
    })();
  }, []);

  // Default theme (VS Code inspired)
  const defaultTheme = useMemo(() => {
    // Mistral-specific theme: white in light mode, app blue-gray background in dark mode
    const isMistral = provider === 'mistral';
    const darkBackground = isMistral ? '#202938' : '#1e1e1e';

    return effectiveTheme === 'dark'
      ? {
          background: darkBackground,
          foreground: '#d4d4d4',
          cursor: '#aeafad',
          cursorAccent: darkBackground,
          selectionBackground: '#264f78',
          black: '#000000',
          red: '#cd3131',
          green: '#0dbc79',
          yellow: '#e5e510',
          blue: '#2472c8',
          magenta: '#bc3fbc',
          cyan: '#11a8cd',
          white: '#e5e5e5',
          brightBlack: '#666666',
          brightRed: '#f14c4c',
          brightGreen: '#23d18b',
          brightYellow: '#f5f543',
          brightBlue: '#3b8eea',
          brightMagenta: '#d670d6',
          brightCyan: '#29b8db',
          brightWhite: '#ffffff',
        }
      : {
          background: '#ffffff',
          foreground: '#1e1e1e',
          cursor: '#1e1e1e',
          cursorAccent: '#ffffff',
          selectionBackground: '#add6ff',
          black: '#000000',
          red: '#cd3131',
          green: '#0dbc79',
          yellow: '#bf8803',
          blue: '#0451a5',
          magenta: '#bc05bc',
          cyan: '#0598bc',
          white: '#e5e5e5',
          brightBlack: '#666666',
          brightRed: '#cd3131',
          brightGreen: '#14ce14',
          brightYellow: '#b5ba00',
          brightBlue: '#0451a5',
          brightMagenta: '#bc05bc',
          brightCyan: '#0598bc',
          brightWhite: '#a5a5a5',
        };
  }, [effectiveTheme, provider]);

  // Merge native theme with defaults (native theme takes precedence)
  const themeOverride = useMemo(() => {
    if (!nativeTheme) {
      return defaultTheme;
    }
    // Merge: native theme values override defaults, but we keep defaults for missing values
    return {
      ...defaultTheme,
      ...nativeTheme,
    };
  }, [nativeTheme, defaultTheme]);

  if (!workspace && !projectPath) {
    return (
      <div
        className={`flex h-full flex-col items-center justify-center bg-gray-50 dark:bg-gray-900 ${className}`}
      >
        <Bot className="mb-2 h-8 w-8 text-gray-400" />
        <h3 className="mb-1 text-sm text-gray-600 dark:text-gray-400">No Task Selected</h3>
        <p className="text-center text-xs text-gray-500 dark:text-gray-500">
          Select a task to view its terminal
        </p>
      </div>
    );
  }

  return (
    <div className={cn('flex h-full flex-col bg-white dark:bg-gray-800', className)}>
      <div className="flex items-center gap-2 border-b border-border bg-gray-50 px-2 py-1.5 dark:bg-gray-900">
        <div className="flex items-center gap-1">
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              {!workspace ? (
                <>
                  <TooltipTrigger asChild>
                    <span className="inline-block">
                      <button
                        type="button"
                        className={cn(
                          'rounded px-2 py-1 text-[11px] font-semibold transition-colors',
                          mode === 'workspace'
                            ? 'bg-background text-foreground shadow-sm'
                            : 'text-muted-foreground hover:bg-background/70',
                          'cursor-not-allowed opacity-50'
                        )}
                        disabled={true}
                        onClick={() => setMode('workspace')}
                      >
                        Worktree
                      </button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[200px]">
                    <p className="text-xs">Select a task to access its worktree terminal.</p>
                  </TooltipContent>
                </>
              ) : (
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      'rounded px-2 py-1 text-[11px] font-semibold transition-colors',
                      mode === 'workspace'
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:bg-background/70'
                    )}
                    onClick={() => setMode('workspace')}
                  >
                    Worktree
                  </button>
                </TooltipTrigger>
              )}
            </Tooltip>
          </TooltipProvider>
          <button
            type="button"
            className={cn(
              'rounded px-2 py-1 text-[11px] font-semibold transition-colors',
              mode === 'global'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-background/70'
            )}
            disabled={!projectPath}
            onClick={() => setMode('global')}
            title={projectPath ? 'Global terminal at project root' : 'No project selected'}
          >
            Global
          </button>
        </div>
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
                      void (async () => {
                        const { captureTelemetry } = await import('../lib/telemetryClient');
                        captureTelemetry('terminal_deleted');
                      })();
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
          onClick={() => {
            void (async () => {
              const { captureTelemetry } = await import('../lib/telemetryClient');
              captureTelemetry('terminal_new_terminal_created', { scope: mode });
            })();
            createTerminal({
              cwd: mode === 'global' ? projectPath : workspace?.path,
            });
          }}
          className="ml-2 flex h-6 w-6 items-center justify-center rounded border border-transparent text-muted-foreground transition hover:border-border hover:bg-background dark:hover:bg-gray-800"
          title={mode === 'global' ? 'New global terminal' : 'New workspace terminal'}
          disabled={mode === 'workspace' && !workspace}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <div
        className={cn(
          'bw-terminal relative flex-1 overflow-hidden',
          effectiveTheme === 'dark'
            ? provider === 'mistral'
              ? 'bg-[#202938]'
              : 'bg-gray-800'
            : 'bg-white'
        )}
      >
        {terminals.map((terminal) => {
          const cwd =
            terminal.cwd ||
            (mode === 'global' ? projectPath || terminal.cwd : workspace?.path || terminal.cwd);
          return (
            <div
              key={terminal.id}
              className={cn(
                'absolute inset-0 h-full w-full transition-opacity',
                terminal.id === activeTerminalId ? 'opacity-100' : 'pointer-events-none opacity-0'
              )}
            >
              <TerminalPane
                id={terminal.id}
                cwd={cwd}
                variant={effectiveTheme === 'dark' ? 'dark' : 'light'}
                themeOverride={themeOverride}
                className="h-full w-full"
                keepAlive
              />
            </div>
          );
        })}
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
