import React, { useState, useEffect } from 'react';
import { CheckCircle2, XCircle, Loader2, Clock } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import { Separator } from '../ui/separator';
import type { Automation, AutomationRunLog } from '@shared/automations/types';
import { formatRelativeTime } from './utils';

interface RunLogsModalProps {
  isOpen: boolean;
  onClose: () => void;
  automation: Automation | null;
  getRunLogs: (automationId: string, limit?: number) => Promise<AutomationRunLog[]>;
}

const RunLogsModal: React.FC<RunLogsModalProps> = ({ isOpen, onClose, automation, getRunLogs }) => {
  const [logs, setLogs] = useState<AutomationRunLog[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen && automation) {
      setIsLoading(true);
      getRunLogs(automation.id, 50)
        .then(setLogs)
        .finally(() => setIsLoading(false));
    }
  }, [isOpen, automation, getRunLogs]);

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

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[80vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">Run History</DialogTitle>
          <DialogDescription className="text-xs">
            {automation?.name ?? 'Automation'} — last {logs.length} runs
          </DialogDescription>
        </DialogHeader>
        <Separator />

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : logs.length === 0 ? (
          <div className="py-8 text-center">
            <Clock className="mx-auto mb-2 h-8 w-8 text-muted-foreground/30" />
            <p className="text-xs text-muted-foreground">No runs yet</p>
          </div>
        ) : (
          <div className="space-y-1">
            {logs.map((run) => (
              <div
                key={run.id}
                className="flex items-center justify-between rounded-md px-3 py-2 hover:bg-muted/50"
              >
                <div className="flex items-center gap-2">
                  {statusIcon(run.status)}
                  <span className="text-xs font-medium capitalize">{run.status}</span>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                  {run.finishedAt && run.startedAt && (
                    <span>
                      {Math.round(
                        (new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) /
                          1000
                      )}
                      s
                    </span>
                  )}
                  <span>{formatRelativeTime(run.startedAt)}</span>
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
