import { AnimatePresence, motion } from 'framer-motion';
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

const PANEL_EASE = [0.22, 1, 0.36, 1] as const;

export function AutomationRunsDrawer({
  automation,
  onClose,
}: {
  automation: Automation | null;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {automation && (
        <>
          <motion.div
            key="runs-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="fixed inset-0 z-30 bg-black/20"
            onClick={onClose}
            aria-hidden
          />
          <motion.aside
            key="runs-panel"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.28, ease: PANEL_EASE }}
            tabIndex={-1}
            ref={(node) => node?.focus()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                onClose();
              }
            }}
            className="fixed right-0 top-0 z-40 flex h-full w-full max-w-md flex-col border-l border-border bg-background shadow-2xl outline-none"
          >
            <DrawerContent automation={automation} onClose={onClose} />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function DrawerContent({ automation, onClose }: { automation: Automation; onClose: () => void }) {
  const { navigate } = useNavigate();
  const runs = useAutomationRuns(automation.id, 20);

  return (
    <>
      <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Run history</h2>
          <p className="mt-1 truncate text-xs text-muted-foreground">{automation.name}</p>
        </div>
        <Button size="icon" variant="ghost" onClick={onClose} aria-label="Close run history">
          <X className="size-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {runs.isPending ? (
          <div className="flex h-32 items-center justify-center">
            <Spinner />
          </div>
        ) : runs.data?.length ? (
          <div className="overflow-hidden rounded-lg border border-border bg-muted/10">
            {runs.data.map((run) => {
              const taskId = run.taskId;
              return (
                <div
                  key={run.id}
                  className="border-b border-border px-3 py-2.5 transition-colors last:border-b-0 hover:bg-muted/30"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={cn('shrink-0', statusClass(run.status))}>
                      {run.status}
                    </Badge>
                    <span className="truncate text-xs text-muted-foreground">
                      {run.triggerKind}
                    </span>
                    {taskId && (
                      <button
                        type="button"
                        className="font-mono text-xs text-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground"
                        onClick={() =>
                          navigate('task', { projectId: automation.projectId, taskId })
                        }
                      >
                        {taskId.slice(0, 8)}
                      </button>
                    )}
                    <RelativeTime
                      value={run.startedAt}
                      className="ml-auto shrink-0 text-xs text-muted-foreground"
                      compact
                      ago
                    />
                  </div>
                  {run.error && <p className="mt-1.5 text-xs text-destructive">{run.error}</p>}
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
    </>
  );
}
