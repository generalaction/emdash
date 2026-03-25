import React, { useState, useEffect } from 'react';
import { CheckCircle2, XCircle, Loader2, Clock, Timer } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Separator } from '../ui/separator';
import type { Automation, AutomationRunLog } from '@shared/automations/types';
import { formatRelativeTime, formatScheduleLabel, formatTriggerLabel } from './utils';

interface RunLogsModalProps {
  isOpen: boolean;
  onClose: () => void;
  automation: Automation | null;
  getRunLogs: (automationId: string, limit?: number) => Promise<AutomationRunLog[]>;
}

const statusIcon = (status: AutomationRunLog['status']) => {
  switch (status) {
    case 'success':
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
    case 'failure':
      return <XCircle className="h-3.5 w-3.5 text-red-500" />;
    case 'running':
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />;
  }
};

const statusLabel = (status: AutomationRunLog['status']) => {
  switch (status) {
    case 'success':
      return 'text-emerald-600 dark:text-emerald-400';
    case 'failure':
      return 'text-red-600 dark:text-red-400';
    case 'running':
      return 'text-blue-600 dark:text-blue-400';
  }
};

const RunLogsModal: React.FC<RunLogsModalProps> = ({ isOpen, onClose, automation, getRunLogs }) => {
  const [logs, setLogs] = useState<AutomationRunLog[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && automation) {
      setIsLoading(true);
      setError(null);
      getRunLogs(automation.id, 50)
        .then(setLogs)
        .catch((err) => setError(err?.message ?? 'Failed to load run history'))
        .finally(() => setIsLoading(false));
    }
  }, [isOpen, automation, getRunLogs]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[80vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">{automation?.name ?? 'Run History'}</DialogTitle>
          <DialogDescription className="text-xs">
            {automation && (
              <span className="flex items-center gap-1.5">
                <Clock className="h-3 w-3" />
                {automation.mode === 'trigger'
                  ? formatTriggerLabel(automation.triggerType)
                  : formatScheduleLabel(automation.schedule)}
                <span className="text-muted-foreground/40">·</span>
                {automation.runCount} run{automation.runCount !== 1 ? 's' : ''} total
              </span>
            )}
          </DialogDescription>
        </DialogHeader>
        <Separator />

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="py-8 text-center">
            <p className="text-xs text-red-500">{error}</p>
          </div>
        ) : logs.length === 0 ? (
          <div className="py-8 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-muted/40">
              <Timer className="h-6 w-6 text-muted-foreground/30" />
            </div>
            <p className="text-xs text-muted-foreground">No runs yet</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {logs.map((run, i) => (
              <div
                key={run.id}
                className="flex items-center justify-between rounded-md px-3 py-2.5 transition-colors hover:bg-muted/40"
              >
                <div className="flex items-center gap-2.5">
                  {statusIcon(run.status)}
                  <div>
                    <span className={`text-xs font-medium capitalize ${statusLabel(run.status)}`}>
                      {run.status}
                    </span>
                    {run.error && (
                      <p className="mt-0.5 max-w-[200px] truncate text-[10px] text-red-500/70">
                        {run.error}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                  {run.finishedAt && run.startedAt && (
                    <span className="tabular-nums">
                      {Math.round(
                        (new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) /
                          1000
                      )}
                      s
                    </span>
                  )}
                  <span className="text-muted-foreground/60">
                    {formatRelativeTime(run.startedAt)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default RunLogsModal;
