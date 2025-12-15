import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { TerminalPane } from './TerminalPane';
import { Bot, Terminal, Plus, X, TreePine, Globe } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { useWorkspaceTerminals } from '@/lib/workspaceTerminalsStore';
import { cn } from '@/lib/utils';
import type { Provider } from '../types';
import { captureTelemetry } from '../lib/telemetryClient';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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
  const [userInitiatedModeChange, setUserInitiatedModeChange] = useState(false);
  const [switchingTerminalId, setSwitchingTerminalId] = useState<string | null>(null);

  const handleModeChange = useCallback((value: string) => {
    if (value === 'workspace' || value === 'global') {
      setUserInitiatedModeChange(true);
      setMode(value);
      // Reset the flag after a short delay to allow future automatic switches
      setTimeout(() => setUserInitiatedModeChange(false), 1000);
    }
  }, []);
  useEffect(() => {
    if (!workspace && mode === 'workspace' && !userInitiatedModeChange) {
      setMode('global');
    }
  }, [workspace, mode, userInitiatedModeChange]);

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

  // Optimized theme calculation with native theme merging
  const themeOverride = useMemo(() => {
    // Mistral-specific theme: white in light mode, app blue-gray background in dark mode
    const isMistral = provider === 'mistral';
    const darkBackground = isMistral ? '#202938' : '#1e1e1e';

    const baseTheme =
      effectiveTheme === 'dark'
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

    // Merge native theme with defaults (native theme takes precedence)
    return nativeTheme ? { ...baseTheme, ...nativeTheme } : baseTheme;
  }, [effectiveTheme, provider, nativeTheme]);

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
        {/* Screen reader-only accessibility descriptions */}
        <span id="terminal-scope-description" className="sr-only">
          Choose between workspace-specific or global terminal scope
        </span>
        {!workspace && (
          <span id="workspace-disabled-reason" className="sr-only">
            Workspace terminal requires an active workspace
          </span>
        )}
        {!projectPath && (
          <span id="global-disabled-reason" className="sr-only">
            Global terminal requires a project path
          </span>
        )}

        <div className="flex items-center gap-1">
          <Select
            value={mode}
            onValueChange={handleModeChange}
            disabled={!workspace && !projectPath}
            aria-label="Terminal scope selector"
            aria-describedby="terminal-scope-description"
          >
            <SelectTrigger
              className={cn(
                'h-auto w-[110px] px-2 py-1 text-[11px] font-semibold transition-colors',
                'rounded border border-border/50 bg-transparent hover:bg-background/70',
                'focus:ring-0 focus:ring-offset-0 data-[placeholder]:text-muted-foreground',
                'shadow-sm'
              )}
              title={
                mode === 'workspace'
                  ? workspace
                    ? 'Workspace terminal'
                    : 'No workspace selected'
                  : projectPath
                    ? 'Global terminal at project root'
                    : 'No project selected'
              }
            >
              <SelectValue placeholder="Select mode" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                value="workspace"
                disabled={!workspace}
                className="text-[11px]"
                aria-describedby={workspace ? '' : 'workspace-disabled-reason'}
              >
                <div className="flex items-center gap-2">
                  <TreePine className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Worktree</span>
                </div>
              </SelectItem>
              <SelectItem
                value="global"
                disabled={!projectPath}
                className="text-[11px]"
                aria-describedby={projectPath ? '' : 'global-disabled-reason'}
              >
                <div className="flex items-center gap-2">
                  <Globe className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Global</span>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex min-w-0 flex-1 items-center space-x-1 overflow-x-auto">
          {terminals.map((terminal) => {
            const isActive = terminal.id === activeTerminalId;
            return (
              <button
                key={terminal.id}
                type="button"
                onClick={() => {
                  if (switchingTerminalId) return; // Prevent multiple simultaneous switches
                  try {
                    setSwitchingTerminalId(terminal.id);
                    setActiveTerminal(terminal.id);
                    // Focus the terminal after switching for accessibility
                    setTimeout(() => {
                      const terminalElement = document.querySelector(
                        `[data-terminal-id="${terminal.id}"]`
                      );
                      if (terminalElement instanceof HTMLElement) {
                        terminalElement.focus();
                      }
                      setSwitchingTerminalId(null);
                    }, 100);
                  } catch (error) {
                    console.error('Failed to switch terminal:', error);
                    setSwitchingTerminalId(null);
                    // Could add user feedback here like a toast notification
                  }
                }}
                className={cn(
                  'group flex items-center space-x-1 rounded px-2 py-1 text-xs font-medium transition-colors',
                  isActive
                    ? 'bg-background text-foreground shadow-sm dark:bg-gray-800 dark:text-gray-50'
                    : 'text-muted-foreground hover:bg-background/70 dark:hover:bg-gray-800'
                )}
                title={terminal.title}
                id={`terminal-tab-${terminal.id}`}
                aria-label={`${terminal.title} ${isActive ? 'active' : 'inactive'} terminal`}
                aria-pressed={isActive}
                aria-controls={terminal.id}
                role="tab"
              >
                {switchingTerminalId === terminal.id ? (
                  <div className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border border-current border-t-transparent" />
                ) : (
                  <Terminal className="h-3.5 w-3.5 shrink-0" />
                )}
                <span className="max-w-[130px] truncate">{terminal.title}</span>
                {terminals.length > 1 ? (
                  <span
                    role="button"
                    tabIndex={-1}
                    onClick={(event) => {
                      event.stopPropagation();
                      captureTelemetry('terminal_deleted');
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
            captureTelemetry('terminal_new_terminal_created', { scope: mode });
            const cwd = mode === 'global' ? projectPath : workspace?.path;
            if (!cwd) {
              console.warn('Cannot create terminal: no working directory available');
              return;
            }
            createTerminal({
              cwd,
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
              data-terminal-id={terminal.id}
              className={cn(
                'absolute inset-0 h-full w-full transition-opacity',
                terminal.id === activeTerminalId ? 'opacity-100' : 'pointer-events-none opacity-0'
              )}
              role="tabpanel"
              aria-labelledby={`terminal-tab-${terminal.id}`}
              tabIndex={terminal.id === activeTerminalId ? 0 : -1}
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
