import { X } from 'lucide-react';
import type { Automation, AutomationRunStatus } from '@shared/automations/types';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { Spinner } from '@renderer/lib/ui/spinner';
import { cn } from '@renderer/utils/utils';
import { useAutomationRuns } from '../useAutomations';

function statusClass(status: AutomationRunStatus) {
  switch (status) {
    case 'success':
      return 'text-emerald-500 border-emerald-500/30 bg-emerald-500/10';
    case 'failed':
      return 'text-destructive border-destructive/30 bg-destructive/10';
    case 'skipped':
      return 'text-amber-500 border-amber-500/30 bg-amber-500/10';
    case 'running':
      return 'text-blue-500 border-blue-500/30 bg-blue-500/10';
  }
}

export function AutomationRunsDrawer({
  automation,
  onClose,
}: {
  automation: Automation | null;
  onClose: () => void;
}) {
  const { navigate } = useNavigate();
  if (!automation) return null;
  return <DrawerContent automation={automation} navigate={navigate} onClose={onClose} />;
}

function DrawerContent({
  automation,
  navigate,
  onClose,
}: {
  automation: Automation;
  navigate: ReturnType<typeof useNavigate>['navigate'];
  onClose: () => void;
}) {
  const runs = useAutomationRuns(automation.id, 20);

  return (
    <aside className="fixed right-0 top-0 z-40 flex h-full w-full max-w-md flex-col border-l border-border bg-background shadow-2xl">
      <div className="flex items-start justify-between gap-4 border-b border-border p-5">
        <div>
          <h2 className="text-sm font-semibold">Run history</h2>
          <p className="mt-1 text-xs text-muted-foreground">{automation.name}</p>
        </div>
        <Button size="icon" variant="ghost" onClick={onClose} aria-label="Close run history">
          <X className="size-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {runs.isPending ? (
          <div className="flex h-32 items-center justify-center">
            <Spinner />
          </div>
        ) : runs.data?.length ? (
          <div className="flex flex-col gap-2">
            {runs.data.map((run) => {
              const taskId = run.taskId;
              return (
                <div key={run.id} className="rounded-lg border border-border bg-muted/20 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="outline" className={cn(statusClass(run.status))}>
                      {run.status}
                    </Badge>
                    <RelativeTime
                      value={run.startedAt}
                      className="text-xs text-muted-foreground"
                      compact
                      ago
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{run.triggerKind}</span>
                    {taskId && (
                      <button
                        type="button"
                        className="font-mono text-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground"
                        onClick={() =>
                          navigate('task', { projectId: automation.projectId, taskId })
                        }
                      >
                        {taskId.slice(0, 8)}
                      </button>
                    )}
                  </div>
                  {run.error && <p className="mt-2 text-xs text-destructive">{run.error}</p>}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            No runs yet.
          </div>
        )}
      </div>
    </aside>
  );
}
