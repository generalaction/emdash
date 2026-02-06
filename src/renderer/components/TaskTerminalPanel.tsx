import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { TerminalPane } from './TerminalPane';
import { Bot, Terminal, Plus, X } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { useTaskTerminals } from '@/lib/taskTerminalsStore';
import { cn } from '@/lib/utils';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';
import { Button } from './ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import type { Agent } from '../types';
import { getTaskEnvVars } from '@shared/task/envVars';

// Track which worktrees have already run their setup script (persists across remounts)
const setupScriptRan = new Set<string>();

/** Clear setup script state for a task (call when task is deleted) */
export function clearSetupScriptState(taskId: string): void {
  for (const key of setupScriptRan) {
    if (key.startsWith(`${taskId}::`)) {
      setupScriptRan.delete(key);
    }
  }
}

interface Task {
  id: string;
  name: string;
  branch: string;
  path: string;
  status: 'active' | 'idle' | 'running';
}

interface Props {
  task: Task | null;
  agent?: Agent;
  className?: string;
  projectPath?: string;
  defaultBranch?: string;
  portSeed?: string;
}

const TaskTerminalPanelComponent: React.FC<Props> = ({
  task,
  agent,
  className,
  projectPath,
  defaultBranch,
  portSeed,
}) => {
  const { effectiveTheme } = useTheme();
  // Use path in the key to differentiate multi-agent variants that share the same task.id
  const taskKey = task ? `${task.id}::${task.path}` : 'task-placeholder';
  const taskTerminals = useTaskTerminals(taskKey, task?.path);
  // Also differentiate global terminals per variant so each agent has its own
  const globalKey = task?.path ? `global::${task.path}` : 'global';
  const globalTerminals = useTaskTerminals(globalKey, projectPath, { defaultCwd: projectPath });

  // Combined selection state: "task::id" or "global::id"
  const [selectedValue, setSelectedValue] = useState<string | null>(() => {
    if (task && taskTerminals.activeTerminalId) {
      return `task::${taskTerminals.activeTerminalId}`;
    }
    if (globalTerminals.activeTerminalId) {
      return `global::${globalTerminals.activeTerminalId}`;
    }
    return null;
  });

  // Parse the selected value to get mode and terminal ID
  const parseValue = (value: string): { mode: 'task' | 'global'; id: string } | null => {
    const match = value.match(/^(task|global)::(.+)$/);
    if (!match) return null;
    return { mode: match[1] as 'task' | 'global', id: match[2] };
  };

  // Stable references for setup script - avoid recreating callback on every render
  const taskRef = useRef(task);
  const projectPathRef = useRef(projectPath);
  taskRef.current = task;
  projectPathRef.current = projectPath;
  const taskEnv = useMemo(() => {
    if (!task || !task.path || !projectPath) return undefined;
    return getTaskEnvVars({
      taskId: task.id,
      taskName: task.name,
      taskPath: task.path,
      projectPath,
      defaultBranch,
      portSeed,
    });
  }, [task?.id, task?.name, task?.path, projectPath, defaultBranch, portSeed]);

  const firstTaskTerminalId = taskTerminals.terminals[0]?.id;

  // Run setup script when a task terminal becomes ready (only once per task/worktree)
  const handleTerminalReady = useCallback(
    (terminalId: string) => {
      const currentTask = taskRef.current;
      const currentProjectPath = projectPathRef.current;
      if (!currentTask || !currentProjectPath) return;

      // Only the primary task terminal is allowed to trigger automatic setup.
      // Additional terminals in the same worktree should open immediately.
      if (terminalId !== firstTaskTerminalId) return;

      const key = `${currentTask.id}::${currentTask.path}`;
      if (setupScriptRan.has(key)) return;

      // Mark as attempted immediately to prevent race conditions
      setupScriptRan.add(key);

      (async () => {
        try {
          const result = await window.electronAPI.lifecycleSetup({
            taskId: currentTask.id,
            taskPath: currentTask.path,
            projectPath: currentProjectPath,
          });
          if (!result.success) {
            console.error('Setup lifecycle phase failed:', result.error);
          }
        } catch (error) {
          console.error('Failed to run setup script:', error);
        }
      })();
    },
    [firstTaskTerminalId]
  );

  // Memoize callbacks per terminal to avoid recreating on every render
  const terminalReadyCallbacks = useMemo(() => {
    const callbacks = new Map<string, () => void>();
    for (const terminal of taskTerminals.terminals) {
      callbacks.set(terminal.id, () => handleTerminalReady(terminal.id));
    }
    return callbacks;
  }, [taskTerminals.terminals, handleTerminalReady]);

  const parsed = selectedValue ? parseValue(selectedValue) : null;

  // Sync selection when store's active terminal changes (e.g., after creating a new terminal)
  useEffect(() => {
    if (taskTerminals.activeTerminalId) {
      const newValue = `task::${taskTerminals.activeTerminalId}`;
      if (selectedValue !== newValue) {
        setSelectedValue(newValue);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only sync when store's activeId changes
  }, [taskTerminals.activeTerminalId]);

  useEffect(() => {
    if (globalTerminals.activeTerminalId) {
      const newValue = `global::${globalTerminals.activeTerminalId}`;
      // Only sync if we're currently in global mode or have no selection
      if (!selectedValue || parsed?.mode === 'global') {
        if (selectedValue !== newValue) {
          setSelectedValue(newValue);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only sync when store's activeId changes
  }, [globalTerminals.activeTerminalId]);

  // Initialize selection and handle terminal removal
  useEffect(() => {
    if (!selectedValue) {
      // Initialize with first available terminal
      if (task && taskTerminals.terminals.length > 0) {
        setSelectedValue(`task::${taskTerminals.terminals[0].id}`);
      } else if (globalTerminals.terminals.length > 0) {
        setSelectedValue(`global::${globalTerminals.terminals[0].id}`);
      }
    } else {
      // Verify selected terminal still exists
      const p = parseValue(selectedValue);
      if (p) {
        const terminals = p.mode === 'task' ? taskTerminals.terminals : globalTerminals.terminals;
        const exists = terminals.some((t) => t.id === p.id);
        if (!exists) {
          // Fall back to first available
          if (p.mode === 'task' && taskTerminals.terminals.length > 0) {
            setSelectedValue(`task::${taskTerminals.terminals[0].id}`);
          } else if (globalTerminals.terminals.length > 0) {
            setSelectedValue(`global::${globalTerminals.terminals[0].id}`);
          } else if (taskTerminals.terminals.length > 0) {
            setSelectedValue(`task::${taskTerminals.terminals[0].id}`);
          } else {
            setSelectedValue(null);
          }
        }
      }
    }
  }, [selectedValue, taskTerminals.terminals, globalTerminals.terminals, task]);

  // Handle selection change
  const handleSelectChange = (value: string) => {
    setSelectedValue(value);
    const p = parseValue(value);
    if (p) {
      if (p.mode === 'task') {
        taskTerminals.setActiveTerminal(p.id);
      } else {
        globalTerminals.setActiveTerminal(p.id);
      }
    }
  };

  // Get current active terminal info
  const activeTerminalId = parsed?.id ?? null;

  // Get display info for the selected terminal
  const selectedTerminalInfo = useMemo(() => {
    if (!parsed) return null;
    const terminals = parsed.mode === 'task' ? taskTerminals.terminals : globalTerminals.terminals;
    const terminal = terminals.find((t) => t.id === parsed.id);
    if (!terminal) return null;
    return {
      title: terminal.title,
      scope: parsed.mode === 'task' ? 'Worktree' : 'Global',
    };
  }, [parsed, taskTerminals.terminals, globalTerminals.terminals]);

  // Total terminal count for close button visibility
  const totalTerminals = taskTerminals.terminals.length + globalTerminals.terminals.length;

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
    const isMistral = agent === 'mistral';
    const darkBackground = isMistral ? '#202938' : '#1e1e1e';
    const blackBackground = isMistral ? '#141820' : '#000000';

    return effectiveTheme === 'dark' || effectiveTheme === 'dark-black'
      ? {
          background: effectiveTheme === 'dark-black' ? blackBackground : darkBackground,
          foreground: '#d4d4d4',
          cursor: '#aeafad',
          cursorAccent: effectiveTheme === 'dark-black' ? blackBackground : darkBackground,
          selectionBackground: 'rgba(96, 165, 250, 0.35)',
          selectionForeground: '#f9fafb',
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
          selectionBackground: 'rgba(59, 130, 246, 0.35)',
          selectionForeground: '#0f172a',
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
  }, [effectiveTheme, agent]);

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

  if (!task && !projectPath) {
    return (
      <div className={`flex h-full flex-col items-center justify-center bg-muted ${className}`}>
        <Bot className="mb-2 h-8 w-8 text-muted-foreground" />
        <h3 className="mb-1 text-sm text-muted-foreground">No Task Selected</h3>
        <p className="text-center text-xs text-muted-foreground dark:text-muted-foreground">
          Select a task to view its terminal
        </p>
      </div>
    );
  }

  return (
    <div className={cn('flex h-full flex-col bg-card', className)}>
      <div className="flex items-center gap-2 border-b border-border bg-muted px-2 py-1.5 dark:bg-background">
        <Select value={selectedValue ?? undefined} onValueChange={handleSelectChange}>
          <SelectTrigger className="h-7 min-w-0 flex-1 border-none bg-transparent px-2 text-xs shadow-none">
            <Terminal className="mr-1.5 h-3.5 w-3.5 shrink-0" />
            {selectedTerminalInfo ? (
              <span className="min-w-0 truncate">{selectedTerminalInfo.title}</span>
            ) : (
              <SelectValue placeholder="Select terminal" />
            )}
          </SelectTrigger>
          {selectedTerminalInfo && (
            <span className="shrink-0 rounded bg-zinc-500/15 px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide text-zinc-600 dark:bg-zinc-400/15 dark:text-zinc-400">
              {selectedTerminalInfo.scope}
            </span>
          )}
          <SelectContent>
            {task && (
              <SelectGroup>
                <div className="flex items-center justify-between px-2 py-1.5">
                  <span className="text-[10px] font-semibold text-muted-foreground">Worktree</span>
                  <button
                    type="button"
                    className="flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void (async () => {
                        const { captureTelemetry } = await import('../lib/telemetryClient');
                        captureTelemetry('terminal_new_terminal_created', { scope: 'task' });
                      })();
                      taskTerminals.createTerminal({ cwd: task?.path });
                    }}
                    title="New worktree terminal"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
                {taskTerminals.terminals.map((terminal) => (
                  <SelectItem
                    key={`task::${terminal.id}`}
                    value={`task::${terminal.id}`}
                    className="text-xs"
                  >
                    {terminal.title}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
            {projectPath && (
              <SelectGroup>
                <div className="flex items-center justify-between px-2 py-1.5">
                  <span className="text-[10px] font-semibold text-muted-foreground">Global</span>
                  <button
                    type="button"
                    className="flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void (async () => {
                        const { captureTelemetry } = await import('../lib/telemetryClient');
                        captureTelemetry('terminal_new_terminal_created', { scope: 'global' });
                      })();
                      globalTerminals.createTerminal({ cwd: projectPath });
                    }}
                    title="New global terminal"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
                {globalTerminals.terminals.map((terminal) => (
                  <SelectItem
                    key={`global::${terminal.id}`}
                    value={`global::${terminal.id}`}
                    className="text-xs"
                  >
                    {terminal.title}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
          </SelectContent>
        </Select>
        {(() => {
          // Can only delete if current group has more than 1 terminal
          const canDelete =
            parsed?.mode === 'task'
              ? taskTerminals.terminals.length > 1
              : globalTerminals.terminals.length > 1;
          return (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => {
                      if (activeTerminalId && parsed && canDelete) {
                        void (async () => {
                          const { captureTelemetry } = await import('../lib/telemetryClient');
                          captureTelemetry('terminal_deleted');
                        })();
                        if (parsed.mode === 'task') {
                          taskTerminals.closeTerminal(activeTerminalId);
                        } else {
                          globalTerminals.closeTerminal(activeTerminalId);
                        }
                      }
                    }}
                    className="ml-auto text-muted-foreground hover:text-destructive"
                    disabled={!activeTerminalId || !canDelete}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="text-xs">
                    {canDelete ? 'Close terminal' : 'Cannot close last terminal'}
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        })()}
      </div>

      <div
        className={cn(
          'bw-terminal relative flex-1 overflow-hidden',
          effectiveTheme === 'dark' || effectiveTheme === 'dark-black'
            ? agent === 'mistral'
              ? effectiveTheme === 'dark-black'
                ? 'bg-[#141820]'
                : 'bg-[#202938]'
              : 'bg-card'
            : 'bg-white'
        )}
      >
        {taskTerminals.terminals.map((terminal) => {
          const isActive = parsed?.mode === 'task' && terminal.id === activeTerminalId;
          return (
            <div
              key={`task::${terminal.id}`}
              className={cn(
                'absolute inset-0 h-full w-full transition-opacity',
                isActive ? 'opacity-100' : 'pointer-events-none opacity-0'
              )}
            >
              <TerminalPane
                id={terminal.id}
                cwd={terminal.cwd || task?.path}
                env={taskEnv}
                variant={
                  effectiveTheme === 'dark' || effectiveTheme === 'dark-black' ? 'dark' : 'light'
                }
                themeOverride={themeOverride}
                className="h-full w-full"
                keepAlive
                onStartSuccess={terminalReadyCallbacks.get(terminal.id)}
              />
            </div>
          );
        })}
        {globalTerminals.terminals.map((terminal) => {
          const isActive = parsed?.mode === 'global' && terminal.id === activeTerminalId;
          return (
            <div
              key={`global::${terminal.id}`}
              className={cn(
                'absolute inset-0 h-full w-full transition-opacity',
                isActive ? 'opacity-100' : 'pointer-events-none opacity-0'
              )}
            >
              <TerminalPane
                id={terminal.id}
                cwd={terminal.cwd || projectPath}
                variant={
                  effectiveTheme === 'dark' || effectiveTheme === 'dark-black' ? 'dark' : 'light'
                }
                themeOverride={themeOverride}
                className="h-full w-full"
                keepAlive
              />
            </div>
          );
        })}
        {totalTerminals === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-xs text-muted-foreground">
            <p>No terminal found.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
};
export const TaskTerminalPanel = React.memo(TaskTerminalPanelComponent);

export default TaskTerminalPanel;
