import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { TerminalPane } from './TerminalPane';
import { Bot, Plus, Play, Square, X } from 'lucide-react';
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

type LifecyclePhaseStatus = 'idle' | 'running' | 'succeeded' | 'failed';
type SelectedMode = 'task' | 'global' | 'lifecycle';
type LifecyclePhase = 'setup' | 'run' | 'teardown';
type LifecycleLogs = Record<LifecyclePhase, string[]>;

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

  const [selectedValue, setSelectedValue] = useState<string>(() => {
    if (task && taskTerminals.activeTerminalId) {
      return `task::${taskTerminals.activeTerminalId}`;
    }
    if (globalTerminals.activeTerminalId) {
      return `global::${globalTerminals.activeTerminalId}`;
    }
    return '';
  });

  const [runStatus, setRunStatus] = useState<LifecyclePhaseStatus>('idle');
  const [setupStatus, setSetupStatus] = useState<LifecyclePhaseStatus>('idle');
  const [teardownStatus, setTeardownStatus] = useState<LifecyclePhaseStatus>('idle');
  const [runActionBusy, setRunActionBusy] = useState(false);
  const [lifecycleLogs, setLifecycleLogs] = useState<LifecycleLogs>({
    setup: [],
    run: [],
    teardown: [],
  });

  const parseValue = (value: string): { mode: SelectedMode; id: string } | null => {
    const match = value.match(/^(task|global|lifecycle)::(.+)$/);
    if (!match) return null;
    return { mode: match[1] as SelectedMode, id: match[2] };
  };

  const parsed = selectedValue ? parseValue(selectedValue) : null;
  const selectedLifecycle =
    parsed?.mode === 'lifecycle' ? (parsed.id as LifecyclePhase) : (null as LifecyclePhase | null);

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

  const refreshLifecycleState = useCallback(async () => {
    if (!task) return;
    const api = window.electronAPI as any;
    if (typeof api?.lifecycleGetState !== 'function') return;
    try {
      const res = await api.lifecycleGetState({ taskId: task.id });
      if (!res?.success || !res.state) return;
      if (res.state.run?.status) setRunStatus(res.state.run.status);
      if (res.state.setup?.status) setSetupStatus(res.state.setup.status);
      if (res.state.teardown?.status) setTeardownStatus(res.state.teardown.status);
    } catch {}
  }, [task?.id]);

  useEffect(() => {
    setRunStatus('idle');
    setSetupStatus('idle');
    setTeardownStatus('idle');
    setRunActionBusy(false);
    setLifecycleLogs({ setup: [], run: [], teardown: [] });
    if (!task) return;

    const api = window.electronAPI as any;
    let cancelled = false;

    void refreshLifecycleState();

    if (typeof api?.onLifecycleEvent !== 'function') {
      return () => {
        cancelled = true;
      };
    }

    const off = api.onLifecycleEvent((evt: any) => {
      if (!evt || evt.taskId !== task.id) return;
      const phase =
        evt.phase === 'setup' || evt.phase === 'run' || evt.phase === 'teardown'
          ? (evt.phase as LifecyclePhase)
          : null;
      if (phase) {
        if (evt.status === 'starting') {
          setLifecycleLogs((prev) => ({
            ...prev,
            [phase]: [...prev[phase], `$ ${phase} started\n`].slice(-300),
          }));
        } else if (evt.status === 'line' && typeof evt.line === 'string') {
          setLifecycleLogs((prev) => ({
            ...prev,
            [phase]: [...prev[phase], evt.line].slice(-300),
          }));
        } else if (evt.status === 'done') {
          setLifecycleLogs((prev) => ({
            ...prev,
            [phase]: [...prev[phase], `$ ${phase} finished (exit ${evt.exitCode ?? 0})\n`].slice(
              -300
            ),
          }));
        } else if (evt.status === 'error') {
          const detail = typeof evt.error === 'string' ? `: ${evt.error}` : '';
          setLifecycleLogs((prev) => ({
            ...prev,
            [phase]: [
              ...prev[phase],
              `$ ${phase} failed (exit ${evt.exitCode ?? 'unknown'})${detail}\n`,
            ].slice(-300),
          }));
        } else if (phase === 'run' && evt.status === 'exit') {
          const code = evt.exitCode === null ? 'signal' : evt.exitCode;
          setLifecycleLogs((prev) => ({
            ...prev,
            run: [...prev.run, `$ run exited (${code})\n`].slice(-300),
          }));
        }
      }

      if (evt.phase === 'setup') {
        if (evt.status === 'starting') setSetupStatus('running');
        if (evt.status === 'done') setSetupStatus('succeeded');
        if (evt.status === 'error') setSetupStatus('failed');
        return;
      }
      if (evt.phase === 'teardown') {
        if (evt.status === 'starting') setTeardownStatus('running');
        if (evt.status === 'done') setTeardownStatus('succeeded');
        if (evt.status === 'error') setTeardownStatus('failed');
        return;
      }
      if (evt.phase !== 'run') return;
      if (evt.status === 'starting') {
        setRunStatus('running');
        return;
      }
      if (evt.status === 'error') {
        setRunStatus('failed');
        return;
      }
      if (evt.status === 'exit') {
        void (async () => {
          if (cancelled) return;
          const apiInner = window.electronAPI as any;
          if (typeof apiInner?.lifecycleGetState === 'function') {
            try {
              const res = await apiInner.lifecycleGetState({ taskId: task.id });
              if (!cancelled && res?.success && res.state?.run?.status) {
                setRunStatus(res.state.run.status);
                return;
              }
            } catch {}
          }
          if (cancelled) return;
          if (evt.exitCode === 0) setRunStatus('succeeded');
          else if (typeof evt.exitCode === 'number') setRunStatus('failed');
          else setRunStatus('idle');
        })();
      }
    });

    return () => {
      cancelled = true;
      off?.();
    };
  }, [task?.id, refreshLifecycleState]);

  // Sync selection when store active terminal changes; don't override lifecycle selection.
  useEffect(() => {
    if (!taskTerminals.activeTerminalId) return;
    if (!selectedValue || parsed?.mode === 'task') {
      const newValue = `task::${taskTerminals.activeTerminalId}`;
      if (selectedValue !== newValue) setSelectedValue(newValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskTerminals.activeTerminalId]);

  useEffect(() => {
    if (!globalTerminals.activeTerminalId) return;
    if (!selectedValue || parsed?.mode === 'global') {
      const newValue = `global::${globalTerminals.activeTerminalId}`;
      if (selectedValue !== newValue) setSelectedValue(newValue);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalTerminals.activeTerminalId]);

  useEffect(() => {
    if (!selectedValue) {
      if (task && taskTerminals.terminals.length > 0) {
        setSelectedValue(`task::${taskTerminals.terminals[0].id}`);
      } else if (globalTerminals.terminals.length > 0) {
        setSelectedValue(`global::${globalTerminals.terminals[0].id}`);
      }
      return;
    }

    const p = parseValue(selectedValue);
    if (!p || p.mode === 'lifecycle') return;

    const terminals = p.mode === 'task' ? taskTerminals.terminals : globalTerminals.terminals;
    const exists = terminals.some((t) => t.id === p.id);
    if (exists) return;

    if (p.mode === 'task' && taskTerminals.terminals.length > 0) {
      setSelectedValue(`task::${taskTerminals.terminals[0].id}`);
    } else if (globalTerminals.terminals.length > 0) {
      setSelectedValue(`global::${globalTerminals.terminals[0].id}`);
    } else if (taskTerminals.terminals.length > 0) {
      setSelectedValue(`task::${taskTerminals.terminals[0].id}`);
    } else {
      setSelectedValue('');
    }
  }, [selectedValue, taskTerminals.terminals, globalTerminals.terminals, task]);

  const handleSelectChange = (value: string) => {
    setSelectedValue(value);
    const p = parseValue(value);
    if (!p) return;
    if (p.mode === 'task') {
      taskTerminals.setActiveTerminal(p.id);
    } else if (p.mode === 'global') {
      globalTerminals.setActiveTerminal(p.id);
    }
  };

  const activeTerminalId = parsed?.mode === 'lifecycle' ? null : (parsed?.id ?? null);
  const totalTerminals = taskTerminals.terminals.length + globalTerminals.terminals.length;

  const canStartRun =
    !!task &&
    !!projectPath &&
    !runActionBusy &&
    runStatus !== 'running' &&
    setupStatus !== 'running' &&
    setupStatus !== 'failed';

  const isRunSelection = !selectedLifecycle || selectedLifecycle === 'run';
  const selectedTerminalScope = useMemo(() => {
    if (parsed?.mode === 'task') return 'WORKTREE';
    if (parsed?.mode === 'global') return 'GLOBAL';
    return null;
  }, [parsed?.mode]);

  const handlePlay = useCallback(async () => {
    if (!task || !projectPath) return;
    const api = window.electronAPI as any;
    setRunActionBusy(true);
    try {
      if (selectedLifecycle === 'setup') {
        await api.lifecycleSetup?.({ taskId: task.id, taskPath: task.path, projectPath });
      } else if (selectedLifecycle === 'teardown') {
        await api.lifecycleTeardown?.({ taskId: task.id, taskPath: task.path, projectPath });
      } else {
        await api.lifecycleRunStart?.({ taskId: task.id, taskPath: task.path, projectPath });
      }
    } catch (error) {
      console.error('Failed lifecycle play action:', error);
    } finally {
      setRunActionBusy(false);
      void refreshLifecycleState();
    }
  }, [task?.id, task?.path, projectPath, selectedLifecycle, refreshLifecycleState]);

  const handleStop = useCallback(async () => {
    if (!task) return;
    const api = window.electronAPI as any;
    setRunActionBusy(true);
    try {
      await api.lifecycleRunStop?.({ taskId: task.id });
    } catch (error) {
      console.error('Failed to stop run phase:', error);
    } finally {
      setRunActionBusy(false);
      void refreshLifecycleState();
    }
  }, [task?.id, refreshLifecycleState]);

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

  useEffect(() => {
    void (async () => {
      try {
        const result = await window.electronAPI.terminalGetTheme();
        if (result?.ok && result.config?.theme) setNativeTheme(result.config.theme);
      } catch (error) {
        console.warn('Failed to load native terminal theme', error);
      }
    })();
  }, []);

  const defaultTheme = useMemo(() => {
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

  const themeOverride = useMemo(() => {
    if (!nativeTheme) return defaultTheme;
    return { ...defaultTheme, ...nativeTheme };
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
        <Select value={selectedValue} onValueChange={handleSelectChange}>
          <SelectTrigger className="h-7 min-w-0 flex-1 justify-between border-none bg-transparent px-2 text-left text-xs shadow-none">
            <span className="flex min-w-0 flex-1 items-center">
              <span className="mr-2 inline-flex w-4 shrink-0 justify-center text-[11px] leading-none text-muted-foreground/90">
                {'>_'}
              </span>
              <SelectValue placeholder="Select target" />
            </span>
          </SelectTrigger>
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

            {task && (
              <SelectGroup>
                <div className="px-2 py-1.5">
                  <span className="text-[10px] font-semibold text-muted-foreground">Lifecycle</span>
                </div>
                <SelectItem value="lifecycle::setup" className="text-xs">
                  Setup
                </SelectItem>
                <SelectItem value="lifecycle::run" className="text-xs">
                  Run
                </SelectItem>
                <SelectItem value="lifecycle::teardown" className="text-xs">
                  Teardown
                </SelectItem>
              </SelectGroup>
            )}
          </SelectContent>
        </Select>
        {selectedTerminalScope && (
          <span className="shrink-0 rounded bg-zinc-500/15 px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide text-zinc-600 dark:bg-zinc-400/15 dark:text-zinc-400">
            {selectedTerminalScope}
          </span>
        )}

        {task && (
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                {isRunSelection && runStatus === 'running' ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={handleStop}
                    disabled={runActionBusy}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Square className="h-3.5 w-3.5" />
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={handlePlay}
                    disabled={
                      runActionBusy ||
                      !projectPath ||
                      (selectedLifecycle === 'run' ? !canStartRun : false)
                    }
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Play className="h-3.5 w-3.5" />
                  </Button>
                )}
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">
                  {isRunSelection && runStatus === 'running'
                    ? 'Stop run script'
                    : selectedLifecycle === 'setup'
                      ? 'Run setup script'
                      : selectedLifecycle === 'teardown'
                        ? 'Run teardown script'
                        : setupStatus === 'running'
                          ? 'Setup is still running'
                          : setupStatus === 'failed'
                            ? 'Setup failed'
                            : 'Start run script'}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {(() => {
          const canDelete =
            parsed?.mode === 'task'
              ? taskTerminals.terminals.length > 1
              : parsed?.mode === 'global'
                ? globalTerminals.terminals.length > 1
                : false;
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
                        } else if (parsed.mode === 'global') {
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
                    {canDelete ? 'Close terminal tab' : 'Cannot close selected item'}
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        })()}
      </div>

      {selectedLifecycle ? (
        <div className="flex h-full flex-1 flex-col overflow-hidden">
          <div className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
            {selectedLifecycle === 'setup'
              ? `Setup status: ${setupStatus}`
              : selectedLifecycle === 'teardown'
                ? `Teardown status: ${teardownStatus}`
                : `Run status: ${runStatus}`}
          </div>
          <pre className="h-full overflow-auto p-3 text-xs leading-relaxed text-foreground">
            {lifecycleLogs[selectedLifecycle].join('') || 'No lifecycle output yet.'}
          </pre>
        </div>
      ) : (
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
      )}
    </div>
  );
};

export const TaskTerminalPanel = React.memo(TaskTerminalPanelComponent);

export default TaskTerminalPanel;
