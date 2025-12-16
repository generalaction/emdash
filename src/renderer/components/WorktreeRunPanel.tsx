import React, { useState } from 'react';
import { Play, Square, Settings, ExternalLink } from 'lucide-react';
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

  if (!workspaceId || !worktreePath || !projectPath) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-500 dark:text-gray-400">
        No worktree selected
      </div>
    );
  }

  const isRunning = state.status === 'running';
  const isStarting = state.status === 'starting';
  const canStart = !isRunning && !isStarting;

  const handleStart = async () => {
    await start({ worktreePath, projectPath });
  };

  const handleStop = async () => {
    await stop();
  };

  return (
    <>
      <div className="flex h-full flex-col">
        {/* Header with controls */}
        <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900/40">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Run Preview
          </div>
          <div className="flex items-center gap-2">
            {canStart ? (
              <button
                onClick={handleStart}
                className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-700"
                title="Start dev server"
              >
                <Play className="h-3 w-3" /> Run
              </button>
            ) : (
              <button
                onClick={handleStop}
                className="inline-flex items-center gap-1 rounded bg-rose-600 px-2 py-1 text-xs text-white hover:bg-rose-700"
                title="Stop dev server"
              >
                <Square className="h-3 w-3" /> Stop
              </button>
            )}
            <button
              onClick={() => setShowConfigEditor(true)}
              className="rounded p-1 text-gray-600 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-800"
              title="Edit run config"
            >
              <Settings className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Status & Preview URL */}
        {state.status !== 'idle' && (
          <div className="border-b border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-center justify-between">
              <div className="text-xs text-gray-700 dark:text-gray-300">
                Status:{' '}
                <span
                  className={`font-medium ${
                    isRunning
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : isStarting
                        ? 'text-yellow-600 dark:text-yellow-400'
                        : state.status === 'error'
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-gray-600 dark:text-gray-400'
                  }`}
                >
                  {state.status}
                </span>
              </div>
              {state.previewUrl && (
                <a
                  href={state.previewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
                >
                  <ExternalLink className="h-3 w-3" /> Open Preview
                </a>
              )}
            </div>
            {state.error && (
              <div className="mt-1 text-xs text-rose-600 dark:text-rose-400">{state.error}</div>
            )}
          </div>
        )}

        {/* Logs */}
        <div className="flex-1 overflow-y-auto bg-gray-900 p-3 font-mono text-[11px] leading-4 text-gray-100">
          {state.logs.length === 0 ? (
            <div className="text-gray-500">No logs yet. Click "Run" to start.</div>
          ) : (
            state.logs.map((log, idx) => (
              <div key={idx} className="whitespace-pre-wrap break-words">
                {log}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Config Editor Modal */}
      <RunConfigEditorModal
        open={showConfigEditor}
        onClose={() => setShowConfigEditor(false)}
        projectPath={projectPath}
        onSave={() => {
          setShowConfigEditor(false);
          // Optionally reload state
        }}
      />
    </>
  );
};
