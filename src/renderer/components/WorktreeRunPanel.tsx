import React, { useState, useMemo } from 'react';
import { Play, Square, Settings, ExternalLink, Terminal, Circle } from 'lucide-react';
import { useWorktreeRun } from '../hooks/useWorktreeRun';
import { RunConfigEditorModal } from './RunConfigEditorModal';

interface WorktreeRunPanelProps {
  workspaceId: string | null;
  worktreePath: string | null;
  projectPath?: string | null;
}

export const WorktreeRunPanel: React.FC<WorktreeRunPanelProps> = ({
  workspaceId,
  worktreePath,
  projectPath,
}) => {
  const { state, start, stop } = useWorktreeRun(workspaceId);
  const [showConfigEditor, setShowConfigEditor] = useState(false);
  const [expandedScripts, setExpandedScripts] = useState<Set<string>>(new Set());

  // Parse config to get scripts
  const scripts = useMemo((): Array<{
    name: string;
    command: string;
    port?: number | null;
    cwd?: string;
    preview?: boolean;
  }> => {
    if (!state.config?.scripts || !Array.isArray(state.config.scripts)) {
      return [];
    }
    return state.config.scripts;
  }, [state.config]);

  // Group logs by script name (format: "[script-name] log message")
  const logsByScript = useMemo(() => {
    const grouped: Record<string, string[]> = {};
    
    // Initialize all scripts
    scripts.forEach((script: { name: string }) => {
      grouped[script.name] = [];
    });

    // Group logs by parsing "[scriptName] message" format
    state.logs.forEach(log => {
      const match = log.match(/^\[([^\]]+)\]\s*(.*)$/);
      if (match) {
        const scriptName = match[1];
        const message = match[2];
        
        if (grouped[scriptName] !== undefined) {
          grouped[scriptName].push(message);
        } else {
          // Unknown script, add to first available
          const firstScript = scripts[0];
          if (firstScript) {
            grouped[firstScript.name].push(log);
          }
        }
      } else {
        // No prefix - shouldn't happen with new backend, but fallback to first script
        const firstScript = scripts[0];
        if (firstScript) {
          grouped[firstScript.name].push(log);
        }
      }
    });

    return grouped;
  }, [state.logs, scripts]);

  if (!workspaceId || !worktreePath || !projectPath) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-gray-500 dark:text-gray-400">
        No worktree selected
      </div>
    );
  }

  const isRunning = state.status === 'running';
  const isStarting = state.status === 'starting';
  const isStopped = state.status === 'stopped' || state.status === 'idle';
  const isError = state.status === 'error';
  const canStart = isStopped && !isError;

  const handleStart = async () => {
    await start({ worktreePath, projectPath });
  };

  const handleStop = async () => {
    await stop();
  };

  const toggleScriptExpanded = (scriptName: string) => {
    setExpandedScripts(prev => {
      const next = new Set(prev);
      if (next.has(scriptName)) {
        next.delete(scriptName);
      } else {
        next.add(scriptName);
      }
      return next;
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running':
        return 'bg-emerald-500 dark:bg-emerald-500';
      case 'starting':
        return 'bg-yellow-500 dark:bg-yellow-500';
      case 'error':
        return 'bg-red-500 dark:bg-red-500';
      default:
        return 'bg-gray-400 dark:bg-gray-500';
    }
  };

  return (
    <>
      <div className="flex h-full flex-col bg-white dark:bg-gray-900">
        {/* Header with overall status and controls */}
        <div className="flex items-center justify-between border-b border-gray-200/80 bg-white/95 px-4 py-3 backdrop-blur-xl dark:border-gray-700/80 dark:bg-gray-900/95">
          <div className="flex items-center gap-2.5">
            <div className={`h-2 w-2 rounded-full ${getStatusColor(state.status)} shadow-sm`} />
            <div className="text-[13px] font-semibold tracking-tight text-gray-900 dark:text-gray-50">
              Run Preview
            </div>
            {!isStopped && (
              <div className="text-[11px] font-medium text-gray-500 dark:text-gray-400">
                {state.status}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {state.previewUrl && (
              <a
                href={state.previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  e.preventDefault();
                  // Force external browser opening
                  if (state.previewUrl) {
                    window.electronAPI?.openExternal?.(state.previewUrl);
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-md bg-blue-500 px-3 py-1.5 text-[13px] font-medium text-white shadow-sm transition-all hover:bg-blue-600 active:scale-[0.98]"
                title="Open in browser"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open Preview
              </a>
            )}
            {canStart ? (
              <button
                onClick={handleStart}
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500 px-3 py-1.5 text-[13px] font-medium text-white shadow-sm transition-all hover:bg-emerald-600 active:scale-[0.98]"
                title="Start dev server"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                Run
              </button>
            ) : (
              <button
                onClick={handleStop}
                className="inline-flex items-center gap-1.5 rounded-md bg-red-500 px-3 py-1.5 text-[13px] font-medium text-white shadow-sm transition-all hover:bg-red-600 active:scale-[0.98]"
                title="Stop all services"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
                Stop
              </button>
            )}
            <button
              onClick={() => setShowConfigEditor(true)}
              className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
              title="Edit configuration"
            >
              <Settings className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Error banner */}
        {state.error && (
          <div className="border-b border-red-200 bg-red-50 px-4 py-2.5 dark:border-red-900/30 dark:bg-red-900/20">
            <div className="text-[13px] text-red-700 dark:text-red-400">
              {state.error}
            </div>
            {state.error.includes('create .emdash/config.json manually') && (
              <button
                onClick={() => setShowConfigEditor(true)}
                className="mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-red-600 px-2.5 py-1 text-[12px] font-medium text-white shadow-sm transition-all hover:bg-red-700 active:scale-[0.98]"
              >
                <Settings className="h-3 w-3" />
                Open Editor
              </button>
            )}
          </div>
        )}

        {/* Script terminals */}
        <div className="flex-1 overflow-hidden">
          {scripts.length === 0 || isStopped ? (
            // Single terminal view when no scripts or stopped
            <div className="flex h-full flex-col">
              <div className="flex items-center gap-2 border-b border-gray-200/80 bg-gray-50/50 px-4 py-2 dark:border-gray-700/80 dark:bg-gray-800/50">
                <Terminal className="h-3.5 w-3.5 text-gray-400" />
                <span className="text-[12px] font-medium text-gray-600 dark:text-gray-400">
                  Console
                </span>
              </div>
              <div className="flex-1 overflow-y-auto bg-[#1e1e1e] p-4 font-mono text-[12px] leading-relaxed text-gray-100">
                {state.logs.length === 0 ? (
                  <div className="text-gray-500">
                    {isStopped 
                      ? 'Ready to run. Click "Run" to start your development server.' 
                      : 'Initializing...'}
                  </div>
                ) : (
                  state.logs.map((log, idx) => (
                    <div key={idx} className="whitespace-pre-wrap break-words">
                      {log}
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : (
            // Multiple terminals when scripts are running
            <div className="flex h-full flex-col divide-y divide-gray-200/80 overflow-y-auto dark:divide-gray-700/80">
              {scripts.map((script: { name: string; command: string; port?: number | null; cwd?: string; preview?: boolean }, idx: number) => {
                const isExpanded = expandedScripts.has(script.name) || scripts.length === 1;
                const scriptLogs = logsByScript[script.name] || [];
                const hasLogs = scriptLogs.length > 0;

                return (
                  <div
                    key={script.name || idx}
                    className={`flex flex-col transition-all ${
                      isExpanded ? 'flex-1' : 'h-[42px]'
                    }`}
                  >
                    {/* Script header */}
                    <button
                      onClick={() => toggleScriptExpanded(script.name)}
                      className="flex items-center justify-between border-b border-gray-200/80 bg-gray-50/80 px-4 py-2.5 transition-colors hover:bg-gray-100/80 dark:border-gray-700/80 dark:bg-gray-800/50 dark:hover:bg-gray-800/80"
                    >
                      <div className="flex items-center gap-2.5">
                        <Circle
                          className={`h-2 w-2 ${
                            isRunning
                              ? 'fill-emerald-500 text-emerald-500'
                              : isStarting
                                ? 'fill-yellow-500 text-yellow-500 animate-pulse'
                                : 'fill-gray-400 text-gray-400'
                          }`}
                        />
                        <Terminal className="h-3.5 w-3.5 text-gray-500 dark:text-gray-400" />
                        <span className="text-[12px] font-semibold text-gray-700 dark:text-gray-300">
                          {script.name}
                        </span>
                        {script.port && (
                          <span className="rounded-md bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                            :{script.port}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {hasLogs && (
                          <span className="text-[10px] text-gray-500 dark:text-gray-400">
                            {scriptLogs.length} lines
                          </span>
                        )}
                        <svg
                          className={`h-3 w-3 text-gray-400 transition-transform ${
                            isExpanded ? 'rotate-180' : ''
                          }`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 9l-7 7-7-7"
                          />
                        </svg>
                      </div>
                    </button>

                    {/* Script logs */}
                    {isExpanded && (
                      <div className="flex-1 overflow-y-auto bg-[#1e1e1e] p-4 font-mono text-[12px] leading-relaxed text-gray-100">
                        {scriptLogs.length === 0 ? (
                          <div className="text-gray-500">
                            {isStarting ? 'Starting...' : 'Waiting for output...'}
                          </div>
                        ) : (
                          scriptLogs.map((log, logIdx) => (
                            <div key={logIdx} className="whitespace-pre-wrap break-words">
                              {log}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Config Editor Modal */}
      <RunConfigEditorModal
        open={showConfigEditor}
        onClose={() => setShowConfigEditor(false)}
        projectPath={projectPath}
        workspaceId={workspaceId}
        onSave={() => {
          setShowConfigEditor(false);
        }}
      />
    </>
  );
};
