import React, { useEffect, useRef, useState } from 'react';
import { Spinner } from './ui/spinner';
import { cn } from '@/lib/utils';
import type { Task } from '../types/app';
import type { LifecyclePhaseStateStatus } from '@shared/lifecycle';
import { formatLifecycleLogLine, MAX_LIFECYCLE_LOG_LINES } from '@shared/lifecycle';
import { stripAnsi } from '@shared/text/stripAnsi';

interface SetupScriptOverlayProps {
  task: Task;
  className?: string;
}

const SetupScriptOverlay: React.FC<SetupScriptOverlayProps> = ({ task, className }) => {
  const [setupStatus, setSetupStatus] = useState<LifecyclePhaseStateStatus>('idle');
  const [setupLogs, setSetupLogs] = useState<string[]>([]);
  const [dotCount, setDotCount] = useState(1);
  const logEndRef = useRef<HTMLDivElement>(null);
  const activeTaskIdRef = useRef<string>(task.id);

  useEffect(() => {
    activeTaskIdRef.current = task.id;
    setSetupStatus('idle');
    setSetupLogs([]);

    const api = window.electronAPI as any;
    let cancelled = false;

    void (async () => {
      if (typeof api?.lifecycleGetState === 'function') {
        try {
          const res = await api.lifecycleGetState({ taskId: task.id });
          if (cancelled) return;
          if (res?.success && res.state?.setup?.status) {
            setSetupStatus(res.state.setup.status);
          }
        } catch {}
      }

      if (typeof api?.lifecycleGetLogs === 'function') {
        try {
          const logsRes = await api.lifecycleGetLogs({ taskId: task.id });
          if (cancelled) return;
          if (logsRes?.success && logsRes.logs?.setup) {
            setSetupLogs(logsRes.logs.setup);
          }
        } catch {}
      }
    })();

    if (typeof api?.onLifecycleEvent !== 'function') {
      return () => {
        cancelled = true;
      };
    }

    const off = api.onLifecycleEvent((evt: any) => {
      if (!evt || evt.taskId !== task.id || evt.phase !== 'setup') return;

      const line = formatLifecycleLogLine('setup', evt.status, evt);
      if (line !== null) {
        setSetupLogs((prev) => [...prev, line].slice(-MAX_LIFECYCLE_LOG_LINES));
      }

      if (evt.status === 'starting') setSetupStatus('running');
      if (evt.status === 'done') setSetupStatus('succeeded');
      if (evt.status === 'error') setSetupStatus('failed');
    });

    return () => {
      cancelled = true;
      off?.();
    };
  }, [task.id]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [setupLogs]);

  useEffect(() => {
    if (setupStatus !== 'running') {
      setDotCount(1);
      return;
    }
    const interval = window.setInterval(() => {
      setDotCount((c) => (c === 3 ? 1 : c + 1));
    }, 500);
    return () => window.clearInterval(interval);
  }, [setupStatus]);

  if (setupStatus !== 'running') return null;

  return (
    <div
      className={cn(
        'absolute inset-0 z-10 flex items-center justify-center bg-background p-6',
        className
      )}
    >
      <div className="flex w-full max-w-xl flex-col items-center gap-4">
        <Spinner size="lg" />
        <p className="text-sm font-medium text-foreground">
          Running setup script{'.'.repeat(dotCount)}
        </p>
        <p className="text-xs text-muted-foreground">
          The agent will start once the setup script completes.
        </p>
        {setupLogs.length > 0 && (
          <div className="w-full">
            <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/50 p-3 font-mono text-xs text-muted-foreground">
              {stripAnsi(setupLogs.join(''), { stripCarriageReturn: true })}
              <span ref={logEndRef} />
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};

export default SetupScriptOverlay;
