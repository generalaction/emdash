import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Spinner } from './ui/spinner';
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
  const [showWarning, setShowWarning] = useState(false);
  const { toast } = useToast();
  const logEndRef = useRef<HTMLDivElement>(null);
  // Track the instanceId so we can filter events for this task's workspace only
  const instanceIdRef = useRef<string | null>(null);

  // Check workspace status on mount / task change
  useEffect(() => {
    setShowWarning(false);
    let cancelled = false;
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

    const unsubComplete = window.electronAPI.onWorkspaceProvisionComplete(
      (data: { instanceId: string; status: string; error?: string }) => {
        if (instanceIdRef.current && data.instanceId !== instanceIdRef.current) return;
        if (data.status === 'ready') {
          setStatus('ready');
          setShowWarning(false);
          clearProvisionLogs(task.id);
          toast({ title: 'Workspace connected', description: 'Remote workspace is ready.' });
        } else {
          setStatus('error');
          setShowWarning(false);
          setErrorMessage(data.error || 'Workspace provisioning failed.');
        }
      }
    );

    const unsubWarning = window.electronAPI.onWorkspaceProvisionTimeoutWarning(
      (data: { instanceId: string }) => {
        if (instanceIdRef.current && data.instanceId !== instanceIdRef.current) return;
        setShowWarning(true);
      }
    );

    return () => {
      unsubProgress();
      unsubComplete();
      unsubWarning();
    };
  }, []);

  // Auto-scroll log to bottom
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  const handleRetry = useCallback(() => {
    const workspaceConfig = task.metadata?.workspace;
    if (!workspaceConfig) return;

    setStatus('provisioning');
    setLines([]);
    clearProvisionLogs(task.id);
    setErrorMessage(null);

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

  const handleTimeoutCancel = useCallback(() => {
    if (instanceIdRef.current) {
      void window.electronAPI.workspaceCancel({ instanceId: instanceIdRef.current });
    }
    setShowWarning(false);
  }, []);

  // Don't render if no workspace or provisioning is complete
  if (!task.metadata?.workspace) return null;
  if (status === 'ready' || status === null) return null;

  return (
    <div
      className={cn(
        'absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-background p-6',
        className
      )}
    >
      {status === 'provisioning' && (
        <>
          <Spinner size="lg" />
          <p className="text-sm font-medium text-foreground">Provisioning workspace...</p>
          <p className="text-xs text-muted-foreground">
            Running provision script. This may take a few minutes.
          </p>
        </>
      )}

      {status === 'error' && (
        <>
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {errorMessage || 'Workspace provisioning failed.'}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleRetry}>
              Retry
            </Button>
          </div>
        </>
      )}

      {lines.length > 0 && (
        <div className="w-full max-w-xl">
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

      {status === 'provisioning' && !showWarning && (
        <Button variant="ghost" size="sm" className="text-xs" onClick={handleCancel}>
          Cancel
        </Button>
      )}
      {status === 'provisioning' && showWarning && (
        <div className="mt-4 flex w-full max-w-sm flex-col items-center gap-4 rounded-lg border border-destructive bg-destructive/10 p-4 text-center">
          <p className="text-sm font-semibold text-destructive">
            Provisioning is taking longer than expected.
          </p>
          <p className="text-xs text-muted-foreground">
            You can keep waiting or cancel and try again.
          </p>
          <div className="flex w-full gap-3">
            <Button variant="outline" className="flex-1" onClick={() => setShowWarning(false)}>
              Keep Waiting
            </Button>
            <Button variant="destructive" className="flex-1" onClick={handleTimeoutCancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkspaceProvisioningOverlay;
