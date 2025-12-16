import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { TerminalPane } from './TerminalPane';
import { Bot, Terminal, Plus, X, ExternalLink } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { useWorkspaceTerminals } from '@/lib/workspaceTerminalsStore';
import { cn } from '@/lib/utils';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from './ui/tooltip';
import type { Provider } from '../types';
import { RunControls } from './terminal/RunControls';
import { RunConfigEditorModal } from './RunConfigEditorModal';
import { useProjectRunConfig } from '../hooks/useProjectRunConfig';
import { validateRunConfig, type ResolvedRunScript } from '../../shared/worktreeRun/config';
import { terminalSessionRegistry } from '../terminal/SessionRegistry';

function normalizeLocalUrl(raw: string): string | null {
  try {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    // Extract first URL-ish token
    const re =
      /(https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|[a-z0-9.-]+):\d{2,5}(?:\/\S*)?)/i;
    const m = trimmed.match(re);
    if (!m?.[1]) return null;
    const url = new URL(m[1].replace('0.0.0.0', 'localhost'));
    // Force localhost for local bind-all addresses
    if (url.hostname === '0.0.0.0' || url.hostname === '127.0.0.1' || url.hostname === '[::1]') {
      url.hostname = 'localhost';
    }
    return url.toString();
  } catch {
    return null;
  }
}

function joinFsPath(base: string, rel: string): string {
  const sep = base.includes('\\') ? '\\' : '/';
  const cleanedBase = base.endsWith(sep) ? base.slice(0, -1) : base;
  const cleanedRel = rel.replace(/^\.?[\\/]+/, '').replace(/[\\/]+/g, sep);
  return cleanedRel ? `${cleanedBase}${sep}${cleanedRel}` : cleanedBase;
}

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
  projectId?: string | null;
}

const WorkspaceTerminalPanelComponent: React.FC<Props> = ({
  workspace,
  provider,
  className,
  projectPath,
  projectId,
}) => {
  const { effectiveTheme } = useTheme();
  const workspaceKey = workspace?.id ?? 'workspace-placeholder';
  const workspaceTerminals = useWorkspaceTerminals(workspaceKey, workspace?.path);
  const globalTerminals = useWorkspaceTerminals('global', projectPath, { defaultCwd: projectPath });
  const [mode, setMode] = useState<'workspace' | 'global'>(workspace ? 'workspace' : 'global');
  const [showRunConfigEditor, setShowRunConfigEditor] = useState(false);
  const [runActive, setRunActive] = useState(false);
  const [runScripts, setRunScripts] = useState<ResolvedRunScript[]>([]);
  const [activeRunScriptName, setActiveRunScriptName] = useState<string | null>(null);
  const [startedRunScriptIds, setStartedRunScriptIds] = useState<Set<string>>(new Set());
  const [activePane, setActivePane] = useState<'normal' | 'run'>('normal');
  const [setupRunning, setSetupRunning] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupLogs, setSetupLogs] = useState<string[]>([]);
  const [showSetupLogs, setShowSetupLogs] = useState(false);
  const [detectedPreviewUrl, setDetectedPreviewUrl] = useState<string | null>(null);
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

  const runConfig = useProjectRunConfig({
    projectId: projectId || null,
    projectPath: projectPath || null,
    preferredProvider: provider || null,
  });

  const runTerminalIdFor = useCallback(
    (workspaceId: string, scriptName: string) => `run-${workspaceId}::${scriptName}`,
    []
  );

  const previewScript = useMemo(() => runScripts.find((s) => s.preview) ?? null, [runScripts]);
  const fallbackPreviewUrl = useMemo(() => {
    const port = previewScript?.port;
    if (!port) return null;
    return `http://localhost:${port}`;
  }, [previewScript]);
  const previewUrl = detectedPreviewUrl || fallbackPreviewUrl;
  const previewIsStarted = useMemo(() => {
    if (!workspace || !previewScript) return false;
    const id = runTerminalIdFor(workspace.id, previewScript.name);
    return startedRunScriptIds.has(id);
  }, [previewScript, runTerminalIdFor, startedRunScriptIds, workspace]);

  // Detect preview URL from RUN terminal output (vite/next/uvicorn/etc).
  useEffect(() => {
    if (!workspace || !previewScript) return;
    if (!runActive) return;
    const id = runTerminalIdFor(workspace.id, previewScript.name);
    // Clear previously detected URL when switching scripts/workspaces
    setDetectedPreviewUrl(null);

    let buffer = '';
    const off = window.electronAPI.onPtyData(id, (chunk) => {
      buffer += chunk;
      // Bound memory
      if (buffer.length > 32_000) buffer = buffer.slice(-32_000);

      // Try to detect on each chunk (works for single-line logs too)
      const url = normalizeLocalUrl(chunk) || normalizeLocalUrl(buffer);
      if (url) {
        setDetectedPreviewUrl((prev) => (prev === url ? prev : url));
      }
    });
    return () => {
      try {
        off?.();
      } catch {}
    };
  }, [previewScript?.name, runActive, runTerminalIdFor, workspace?.id]);

  const stopRun = useCallback(() => {
    if (!workspace) return;
    try {
      void (window.electronAPI as any).worktreeRunSetupStepsCancel?.({ workspaceId: workspace.id });
    } catch {}
    const ids = runScripts.map((s) => runTerminalIdFor(workspace.id, s.name));
    ids.forEach((id) => {
      try {
        window.electronAPI.ptyKill(id);
        // Clear terminal output
        const session = terminalSessionRegistry.getSession(id);
        session?.clear();
      } catch {}
    });
    setRunActive(false);
    setRunScripts([]);
    setActiveRunScriptName(null);
    setStartedRunScriptIds(new Set());
    setActivePane('normal');
    setSetupRunning(false);
    setSetupError(null);
    setSetupLogs([]);
    setShowSetupLogs(false);
    setDetectedPreviewUrl(null);
  }, [runScripts, runTerminalIdFor, workspace]);

  // Stream setup logs from main process (setupSteps runner)
  useEffect(() => {
    if (!workspace?.id) return;
    const off = (window.electronAPI as any).onWorktreeRunSetupStepsEvent?.((event: any) => {
      try {
        if (!event || event.workspaceId !== workspace.id) return;
        if (event.type !== 'setupSteps') return;
        if (event.status === 'starting') {
          const step = typeof event.step === 'string' ? event.step : '';
          if (step) {
            setSetupLogs((prev) => [...prev, `\n$ ${step}\n`]);
          }
          return;
        }
        if (event.status === 'line' && typeof event.line === 'string') {
          setSetupLogs((prev) => [...prev, event.line]);
          return;
        }
        if (event.status === 'done') {
          setSetupRunning(false);
          return;
        }
        if (event.status === 'cancelled') {
          setSetupRunning(false);
          setSetupError('Setup cancelled.');
          return;
        }
        if (event.status === 'error') {
          setSetupRunning(false);
          const msg =
            typeof event.line === 'string' && event.line.trim().length
              ? event.line.trim()
              : 'Setup failed.';
          setSetupError(msg);
          return;
        }
      } catch {}
    });
    return () => {
      try {
        off?.();
      } catch {}
    };
  }, [workspace?.id]);

  const startRun = useCallback(async () => {
    if (!workspace || !projectPath || !projectId) return;

    // Clear any existing run terminals before starting new run
    if (runScripts.length > 0) {
      const ids = runScripts.map((s) => runTerminalIdFor(workspace.id, s.name));
      ids.forEach((id) => {
        try {
          const session = terminalSessionRegistry.getSession(id);
          session?.clear();
        } catch {}
      });
    }

    // Ensure config exists (this may trigger generation)
    const ensured = await runConfig.ensure({ force: false });
    if (!ensured || ensured.status !== 'ready') {
      // If failed, open editor (user can fix/regenerate)
      if (ensured?.status === 'failed') {
        setShowRunConfigEditor(true);
      }
      return;
    }

    const loaded = await (window.electronAPI as any).worktreeRunLoadConfig({ projectPath });
    if (!loaded.ok || !loaded.config) {
      setShowRunConfigEditor(true);
      return;
    }

    const validated = validateRunConfig(loaded.config);
    if (!validated.ok) {
      setShowRunConfigEditor(true);
      return;
    }

    // Run setup steps (dependency installs) before starting scripts
    const setupSteps = validated.config.setupSteps || [];
    if (setupSteps.length > 0) {
      setSetupError(null);
      setSetupLogs([]);
      setSetupRunning(true);
      setShowSetupLogs(true);
      try {
        const result = await (window.electronAPI as any).worktreeRunSetupStepsStart?.({
          workspaceId: workspace.id,
          worktreePath: workspace.path,
          steps: setupSteps,
        });
        if (!result?.ok) {
          setSetupRunning(false);
          setSetupError(result?.error || 'Setup failed.');
          setShowRunConfigEditor(true);
          return;
        }
      } catch (e: any) {
        setSetupRunning(false);
        setSetupError(e?.message || 'Setup failed.');
        setShowRunConfigEditor(true);
        return;
      }
      setSetupRunning(false);
      setShowSetupLogs(false);
    }

    const scripts = validated.config.scripts;
    setRunScripts(scripts);
    setActiveRunScriptName(scripts[0]?.name ?? null);
    setStartedRunScriptIds(new Set());
    setRunActive(true);
    setActivePane('run');
  }, [projectId, projectPath, runConfig, workspace]);

  // If workspace changes while RUN is active, stop RUN (prevents leaking PTYs between tasks)
  useEffect(() => {
    if (!runActive) return;
    stopRun();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.id]);

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
        <div className="h-4 w-px bg-border" />
        <div className="flex min-w-0 flex-1 items-center space-x-1 overflow-x-auto">
          {terminals.map((terminal) => {
            const isActive = activePane === 'normal' && terminal.id === activeTerminalId;
            return (
              <button
                key={terminal.id}
                type="button"
                onClick={() => {
                  setActiveTerminal(terminal.id);
                  setActivePane('normal');
                  setActiveRunScriptName(null);
                }}
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
          className="ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded border border-transparent text-muted-foreground transition hover:border-border hover:bg-background dark:hover:bg-gray-800"
          title={mode === 'global' ? 'New global terminal' : 'New workspace terminal'}
          disabled={mode === 'workspace' && !workspace}
        >
          <Plus className="h-4 w-4" />
        </button>
        <div className="relative z-10 ml-2 flex items-center gap-2 bg-gray-50 dark:bg-gray-900">

          {/* Open preview (only when RUN is active) */}
          {runActive && previewUrl ? (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => {
                      if (!previewUrl) return;
                      try {
                        void window.electronAPI.openExternal(previewUrl);
                      } catch {
                        // last-resort fallback
                        try {
                          window.open(previewUrl, '_blank', 'noopener,noreferrer');
                        } catch {}
                      }
                    }}
                    disabled={!previewIsStarted}
                    className={cn(
                      'flex h-6 w-6 items-center justify-center rounded border border-transparent text-muted-foreground transition',
                      'hover:border-border hover:bg-background hover:text-foreground dark:hover:bg-gray-800',
                      'disabled:cursor-not-allowed disabled:opacity-50'
                    )}
                    title={previewIsStarted ? `Open ${previewUrl}` : 'Waiting for the preview service to start...'}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[240px]">
                  <p className="text-xs">
                    {previewIsStarted
                      ? `Open ${previewUrl}`
                      : 'Waiting for the preview service to start...'}
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}

          {/* Inline Run controls (status wired in next step) */}
          <RunControls
            status={runConfig.status}
            running={runActive}
            setupRunning={setupRunning}
            setupError={setupError}
            disabled={!workspace || !projectPath || !projectId}
            error={runConfig.error}
            onRun={() => {
              void startRun();
            }}
            onStop={stopRun}
            onOpenSettings={() => setShowRunConfigEditor(true)}
          />
        </div>
      </div>

      {/* Setup logs (only while running setup or when setup failed and user expanded) */}
      {(setupRunning || (setupError && showSetupLogs)) && setupLogs.length > 0 ? (
        <div className="border-b border-border bg-white px-3 py-2 font-mono text-[11px] leading-4 text-gray-900 dark:bg-black/90 dark:text-gray-100">
          <div className="mb-1 flex items-center justify-between">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300">
              Setup
              {setupRunning ? ' (running)' : setupError ? ' (failed)' : ''}
            </div>
            <button
              type="button"
              className="text-[10px] font-semibold text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
              onClick={() => setShowSetupLogs((v) => !v)}
            >
              {showSetupLogs ? 'Hide' : 'Show'}
            </button>
          </div>
          {showSetupLogs ? (
            <div className="max-h-[140px] overflow-auto whitespace-pre-wrap">
              {setupLogs.slice(-200).join('')}
            </div>
          ) : null}
        </div>
      ) : setupError ? (
        <div className="border-b border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-900 dark:text-amber-200">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 truncate">
              <span className="font-semibold">Setup failed:</span> {setupError}
            </div>
            <button
              type="button"
              className="shrink-0 text-[11px] font-semibold underline underline-offset-2"
              onClick={() => setShowSetupLogs(true)}
            >
              Show logs
            </button>
          </div>
        </div>
      ) : null}

      {/* RUN terminals row (only while running) */}
      {runActive && runScripts.length > 0 && workspace ? (
        <div className="flex items-center gap-2 border-b border-border bg-gray-50/60 px-2 py-1.5 dark:bg-gray-900/60">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Run:
          </div>
          <div className="flex min-w-0 flex-1 items-center space-x-1 overflow-x-auto">
            {runScripts.map((script) => {
              const isActive = activeRunScriptName === script.name;
              return (
                <button
                  key={script.name}
                  type="button"
                  onClick={() => {
                    setActiveRunScriptName(script.name);
                    setActivePane('run');
                  }}
                  className={cn(
                    'group flex items-center space-x-1 rounded px-2 py-1 text-xs font-semibold transition-colors',
                    isActive
                      ? 'bg-background text-foreground shadow-sm dark:bg-gray-800 dark:text-gray-50'
                      : 'text-muted-foreground hover:bg-background/70 dark:hover:bg-gray-800'
                  )}
                  title={script.command}
                >
                  <Terminal className="h-3.5 w-3.5 shrink-0" />
                  <span className="max-w-[160px] truncate">{script.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

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
        {/* Normal terminals */}
        {terminals.map((terminal) => {
          const cwd =
            terminal.cwd ||
            (mode === 'global' ? projectPath || terminal.cwd : workspace?.path || terminal.cwd);
          const visible = (!runActive || activePane === 'normal') && terminal.id === activeTerminalId;
          return (
            <div
              key={terminal.id}
              className={cn(
                'absolute inset-0 h-full w-full transition-opacity',
                visible ? 'opacity-100' : 'pointer-events-none opacity-0'
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

        {/* RUN terminals */}
        {runActive && workspace
          ? runScripts.map((script) => {
              const id = runTerminalIdFor(workspace.id, script.name);
              const cwd =
                script.cwd && script.cwd !== '.'
                  ? joinFsPath(workspace.path, script.cwd)
                  : workspace.path;
              const isVisible = activePane === 'run' && activeRunScriptName === script.name;
              const env = runConfig.env || undefined;
              return (
                <div
                  key={id}
                  className={cn(
                    'absolute inset-0 h-full w-full transition-opacity',
                    isVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
                  )}
                >
                  <TerminalPane
                    id={id}
                    cwd={cwd}
                    env={env}
                    variant={effectiveTheme === 'dark' ? 'dark' : 'light'}
                    themeOverride={themeOverride}
                    className="h-full w-full"
                    keepAlive={false}
                    onStartSuccess={() => {
                      setStartedRunScriptIds((prev) => {
                        if (prev.has(id)) return prev;
                        const next = new Set(prev);
                        next.add(id);
                        try {
                          // Clear terminal before starting new command
                          const session = terminalSessionRegistry.getSession(id);
                          session?.clear();
                          window.electronAPI.ptyInput({ id, data: `${script.command}\n` });
                        } catch {}
                        return next;
                      });
                    }}
                  />
                </div>
              );
            })
          : null}
        {!terminals.length || !activeTerminal ? (
          <div className="flex h-full flex-col items-center justify-center text-xs text-muted-foreground">
            <p>No terminal found.</p>
          </div>
        ) : null}
      </div>

      {/* Run config editor */}
      {projectPath ? (
        <RunConfigEditorModal
          open={showRunConfigEditor}
          onClose={() => setShowRunConfigEditor(false)}
          projectPath={projectPath}
          workspaceId={workspace?.id || null}
          onSave={() => setShowRunConfigEditor(false)}
        />
      ) : null}
    </div>
  );
};
export const WorkspaceTerminalPanel = React.memo(WorkspaceTerminalPanelComponent);

export default WorkspaceTerminalPanel;
