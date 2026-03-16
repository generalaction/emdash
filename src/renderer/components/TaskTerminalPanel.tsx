import { Plus, X } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@renderer/lib/utils';
import { rpc } from '../core/ipc';
import { TerminalPane } from '../core/terminals/terminal-pane';

interface Terminal {
  id: string;
  taskId: string;
  name: string;
}

interface Task {
  id: string;
  name: string;
  path: string;
}

interface Props {
  task: Task | null;
  className?: string;
  remote?: {
    connectionId: string;
    projectPath?: string;
  };
}

const TaskTerminalPanelComponent: React.FC<Props> = ({ task, className, remote }) => {
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const taskIdRef = useRef<string | null>(null);
  const terminalRefs = useRef<Map<string, { focus: () => void }>>(new Map());

  const setTerminalRef = useCallback((id: string, ref: { focus: () => void } | null) => {
    if (ref) {
      terminalRefs.current.set(id, ref);
    } else {
      terminalRefs.current.delete(id);
    }
  }, []);

  useEffect(() => {
    const id = activeTerminalId;
    if (!id) return;
    const timer = setTimeout(() => {
      terminalRefs.current.get(id)?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, [activeTerminalId]);

  useEffect(() => {
    if (!task) {
      setTerminals([]);
      setActiveTerminalId(null);
      return;
    }

    const taskId = task.id;
    taskIdRef.current = taskId;
    setLoading(true);

    void (async () => {
      try {
        let list = await rpc.terminals.getTerminals(taskId);
        if (taskIdRef.current !== taskId) return;

        if (list.length === 0) {
          const result = await rpc.terminals.createTerminal(taskId);
          if (taskIdRef.current !== taskId) return;
          if (result.success && result.data) {
            list = await rpc.terminals.getTerminals(taskId);
            if (taskIdRef.current !== taskId) return;
          }
        }

        setTerminals(list);
        setActiveTerminalId((prev) => {
          const ids = list.map((t) => t.id);
          if (prev && ids.includes(prev)) return prev;
          return ids[0] ?? null;
        });
      } finally {
        if (taskIdRef.current === taskId) setLoading(false);
      }
    })();
  }, [task?.id]);

  const handleCreate = useCallback(async () => {
    if (!task) return;
    const taskId = task.id;
    const result = await rpc.terminals.createTerminal(taskId);
    if (!result.success || !result.data) return;
    const { terminalId } = result.data;
    const list = await rpc.terminals.getTerminals(taskId);
    if (taskIdRef.current !== taskId) return;
    setTerminals(list);
    setActiveTerminalId(terminalId);
  }, [task]);

  const handleClose = useCallback(
    async (terminalId: string) => {
      if (terminals.length <= 1) return;
      await rpc.terminals.deleteTerminal(terminalId);
      setTerminals((prev) => {
        const next = prev.filter((t) => t.id !== terminalId);
        setActiveTerminalId((current) => {
          if (current !== terminalId) return current;
          return next[0]?.id ?? null;
        });
        return next;
      });
    },
    [terminals.length]
  );

  if (!task) {
    return (
      <div
        className={cn(
          'flex h-full flex-col items-center justify-center bg-muted text-sm text-muted-foreground',
          className
        )}
      >
        <span>Select a task to open its terminal.</span>
      </div>
    );
  }

  return (
    <div className={cn('flex h-full min-w-0 flex-col bg-card', className)}>
      {/* Tab strip */}
      <div className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border bg-muted px-1 py-1 dark:bg-background">
        {terminals.map((terminal) => (
          <div
            key={terminal.id}
            className={cn(
              'group flex shrink-0 items-center rounded text-xs transition-colors',
              terminal.id === activeTerminalId
                ? 'bg-background text-foreground shadow-sm dark:bg-muted/60'
                : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
            )}
          >
            <button
              type="button"
              className="max-w-[120px] truncate px-2 py-0.5"
              onClick={() => setActiveTerminalId(terminal.id)}
            >
              {terminal.name}
            </button>
            {terminals.length > 1 && (
              <button
                type="button"
                className="mr-1 rounded opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                onClick={() => void handleClose(terminal.id)}
                title="Close terminal"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={() => void handleCreate()}
          className="ml-1 flex shrink-0 items-center rounded p-0.5 text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
          title="New terminal"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        {loading && terminals.length === 0 && (
          <span className="ml-2 text-xs text-muted-foreground">Loading...</span>
        )}
      </div>

      {/* Terminal panes (keepAlive pattern) */}
      <div className="relative flex-1 overflow-hidden bg-card">
        {terminals.map((terminal) => {
          const isActive = terminal.id === activeTerminalId;
          return (
            <div
              key={terminal.id}
              className={cn(
                'absolute inset-0 h-full w-full transition-opacity',
                isActive ? 'opacity-100' : 'pointer-events-none opacity-0'
              )}
            >
              <TerminalPane
                ref={(r) => setTerminalRef(terminal.id, r)}
                id={terminal.id}
                remote={remote?.connectionId ? { connectionId: remote.connectionId } : undefined}
                className="h-full w-full"
                keepAlive
              />
            </div>
          );
        })}
        {!loading && terminals.length === 0 && (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            <span>No terminals. Click + to create one.</span>
          </div>
        )}
      </div>
    </div>
  );
};

export const TaskTerminalPanel = React.memo(TaskTerminalPanelComponent);

export default TaskTerminalPanel;
