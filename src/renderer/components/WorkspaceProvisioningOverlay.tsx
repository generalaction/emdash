import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';
import type { Task } from '../types/app';
import type { Project } from '../types/app';
import { useToast } from '../hooks/use-toast';
import { getProvisionLogs, appendProvisionLog, clearProvisionLogs } from '../lib/provisionLogCache';

type ProvisioningStatus = 'provisioning' | 'error' | 'ready' | null;

interface WorkspaceProvisioningOverlayProps {
  task: Task;
  project: Project;
  className?: string;
}

const WorkspaceProvisioningOverlay: React.FC<WorkspaceProvisioningOverlayProps> = ({
  task,
  project,
  className,
}) => {
  const [status, setStatus] = useState<ProvisioningStatus>(null);
  const [lines, setLines] = useState<string[]>(() => getProvisionLogs(task.id));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showTimeoutWarning, setShowTimeoutWarning] = useState(false);
  const [dotCount, setDotCount] = useState(1);
  const { toast } = useToast();
  const logEndRef = useRef<HTMLDivElement>(null);
  // Track the instanceId so we can filter events for this task's workspace only
  const instanceIdRef = useRef<string | null>(null);

  // Check workspace status on mount / task change
  useEffect(() => {
    let cancelled = false;
    instanceIdRef.current = null;
    setLines(getProvisionLogs(task.id));
    setErrorMessage(null);
    setShowTimeoutWarning(false);

    void (async () => {
      try {
        const result = await window.electronAPI.workspaceStatus({ taskId: task.id });
        if (cancelled) return;
        if (!result.success || !result.data) {
          setStatus(null);
          return;
        }
        const instance = result.data;
        instanceIdRef.current = instance.id;
        if (instance.status === 'provisioning') {
          setStatus('provisioning');
        } else if (instance.status === 'error') {
          setStatus('error');
          setErrorMessage('Workspace provisioning failed.');
        } else if (instance.status === 'ready') {
          setStatus('ready');
        } else {
          setStatus(null);
        }
      } catch {
        if (!cancelled) setStatus(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [task.id]);

  // Subscribe to provisioning progress events (filtered by instanceId)
  useEffect(() => {
    const unsubProgress = window.electronAPI.onWorkspaceProvisionProgress(
      (data: { instanceId: string; line: string }) => {
        // Only handle events for our task's workspace instance
        if (instanceIdRef.current && data.instanceId !== instanceIdRef.current) return;
        setLines(() => appendProvisionLog(task.id, data.line));
      }
    );

    const unsubTimeoutWarning = window.electronAPI.onWorkspaceProvisionTimeoutWarning(
      (data: { instanceId: string; timeoutMs: number }) => {
        if (instanceIdRef.current && data.instanceId !== instanceIdRef.current) return;
        setShowTimeoutWarning(true);
      }
    );

    const unsubComplete = window.electronAPI.onWorkspaceProvisionComplete(
      (data: { instanceId: string; status: string; error?: string }) => {
        if (instanceIdRef.current && data.instanceId !== instanceIdRef.current) return;
        setShowTimeoutWarning(false);
        if (data.status === 'ready') {
          setStatus('ready');
          clearProvisionLogs(task.id);
          toast({ title: 'Workspace connected', description: 'Remote workspace is ready.' });
        } else {
          setStatus('error');
          setErrorMessage(data.error || 'Workspace provisioning failed.');
        }
      }
    );

    return () => {
      unsubProgress();
      unsubTimeoutWarning();
      unsubComplete();
    };
  }, [task.id, toast]);

  // Auto-scroll log to bottom
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  useEffect(() => {
    if (status !== 'provisioning') {
      setDotCount(1);
      return;
    }

    const interval = window.setInterval(() => {
      setDotCount((count) => (count === 3 ? 1 : count + 1));
    }, 500);

    return () => window.clearInterval(interval);
  }, [status]);

  const handleRetry = useCallback(() => {
    const workspaceConfig = task.metadata?.workspace;
    if (!workspaceConfig) return;

    setStatus('provisioning');
    setLines([]);
    clearProvisionLogs(task.id);
    setErrorMessage(null);
    setShowTimeoutWarning(false);

    void window.electronAPI
      .workspaceProvision({
        taskId: task.id,
        repoUrl: project.gitInfo.remote || '',
        branch: task.branch,
        baseRef: project.gitInfo.baseRef || 'main',
        provisionCommand: workspaceConfig.provisionCommand,
        projectPath: project.path,
      })
      .then((result) => {
        if (result.success && result.data) {
          instanceIdRef.current = result.data.instanceId;
        }
      })
      .catch(() => {
        setStatus('error');
        setErrorMessage('Failed to start provisioning.');
      });
  }, [task, project]);

  const handleKeepWaiting = useCallback(() => {
    setShowTimeoutWarning(false);
  }, []);

  const handleCancel = useCallback(async () => {
    try {
      const result = await window.electronAPI.workspaceStatus({ taskId: task.id });
      if (result.success && result.data) {
        await window.electronAPI.workspaceCancel({ instanceId: result.data.id });
      }
    } catch {
      // Best effort
    }
  }, [task.id]);

  // Don't render if no workspace or provisioning is complete
  if (!task.metadata?.workspace) return null;
  if (status === 'ready' || status === null) return null;

  return (
    <div
      className={cn(
        'absolute inset-0 z-10 flex items-center justify-center bg-background p-6',
        className
      )}
    >
      <div className="flex w-full max-w-xl flex-col items-start gap-4 text-left">
        {status === 'provisioning' && (
          <>
            <div className="flex flex-col items-start gap-3">
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  Provisioning workspace{'.'.repeat(dotCount)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Running provision script. This may take a few minutes.
                </p>
              </div>
            </div>
            {showTimeoutWarning && (
              <div className="w-full rounded-xl border border-border/70 bg-background/95 px-4 py-3 text-sm text-foreground shadow-sm">
                <p className="font-medium">Provisioning is taking longer than expected.</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  The provision script is still running. Large repositories can take longer than
                  five minutes to prepare.
                </p>
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="outline" onClick={handleKeepWaiting}>
                    Keep waiting
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleCancel}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        {status === 'error' && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {errorMessage || 'Workspace provisioning failed.'}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleRetry}>
                Retry
              </Button>
            </div>
          </div>
        )}

        {lines.length > 0 && (
          <div className="w-full">
            <div className="max-h-48 overflow-y-auto rounded-md border bg-muted/50 p-3 font-mono text-xs text-muted-foreground">
              {lines.map((line, i) => (
                <div key={i} className="whitespace-pre-wrap">
                  {line}
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>
        )}

        {status === 'provisioning' && !showTimeoutWarning && (
          <Button variant="ghost" size="sm" className="text-xs" onClick={handleCancel}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
};

export default WorkspaceProvisioningOverlay;
