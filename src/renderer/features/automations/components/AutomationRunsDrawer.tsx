import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, X } from 'lucide-react';
import type {
  Automation,
  AutomationRun,
  AutomationRunStatus,
  AutomationRunTriggerKind,
} from '@shared/automations/types';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { Button } from '@renderer/lib/ui/button';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { Spinner } from '@renderer/lib/ui/spinner';
import { cn } from '@renderer/utils/utils';
import { useAutomationRuns } from '../useAutomations';

function statusDotClass(status: AutomationRunStatus) {
  switch (status) {
    case 'success':
      return 'bg-emerald-500';
    case 'failed':
      return 'bg-destructive';
    case 'skipped':
      return 'bg-amber-500';
    case 'running':
      return 'bg-blue-500';
  }
}

function statusLabel(status: AutomationRunStatus) {
  switch (status) {
    case 'success':
      return 'Success';
    case 'failed':
      return 'Failed';
    case 'skipped':
      return 'Skipped';
    case 'running':
      return 'Running';
  }
}

function triggerLabel(kind: AutomationRunTriggerKind) {
  switch (kind) {
    case 'cron':
      return 'Schedule';
    case 'manual':
      return 'Manual';
    case 'event':
      return 'Event';
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

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {runs.isPending ? (
          <div className="flex h-32 items-center justify-center">
            <Spinner />
          </div>
        ) : runs.data?.length ? (
          <ul className="flex flex-col">
            {runs.data.map((run) => (
              <RunRow
                key={run.id}
                run={run}
                onOpenTask={(taskId) =>
                  navigate('task', { projectId: automation.projectId, taskId })
                }
              />
            ))}
          </ul>
        ) : (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            No runs yet.
          </div>
        )}
      </div>
    </>
  );
}

function RunRow({ run, onOpenTask }: { run: AutomationRun; onOpenTask: (taskId: string) => void }) {
  const taskId = run.taskId;
  const interactive = Boolean(taskId);

  const content = (
    <>
      <span
        className={cn('size-2 shrink-0 rounded-full', statusDotClass(run.status))}
        aria-hidden
      />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-sm font-medium text-foreground">
          {statusLabel(run.status)}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground/60">·</span>
        <span className="truncate text-xs text-muted-foreground">
          {triggerLabel(run.triggerKind)}
        </span>
      </div>
      <RelativeTime
        value={run.startedAt}
        className="shrink-0 text-xs text-muted-foreground"
        compact
        ago
      />
      {interactive ? (
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
      ) : (
        <span className="size-3.5 shrink-0" aria-hidden />
      )}
    </>
  );

  return (
    <li>
      {interactive && taskId ? (
        <button
          type="button"
          onClick={() => onOpenTask(taskId)}
          className="group flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-muted/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {content}
        </button>
      ) : (
        <div className="flex items-center gap-3 px-3 py-2.5">{content}</div>
      )}
      {run.error && (
        <p className="mx-3 mb-2 mt-0.5 line-clamp-2 text-xs text-destructive">{run.error}</p>
      )}
    </li>
  );
}
