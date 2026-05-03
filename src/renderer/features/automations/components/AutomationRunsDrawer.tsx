import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo, useState } from 'react';
import { formatRunStatusLabel, formatRunTriggerKindLabel } from '@shared/automations/format';
import type { Automation, AutomationRun } from '@shared/automations/types';
import { getRegisteredTaskData, getTaskView } from '@renderer/features/tasks/stores/task-selectors';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { Button } from '@renderer/lib/ui/button';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { Spinner } from '@renderer/lib/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import { useAutomationRuns } from '../useAutomations';

const PANEL_EASE = [0.22, 1, 0.36, 1] as const;
const RUNS_PAGE_SIZE = 20;

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
            <DrawerContent key={automation.id} automation={automation} onClose={onClose} />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function DrawerContent({ automation, onClose }: { automation: Automation; onClose: () => void }) {
  const { navigate } = useNavigate();
  const [visibleLimit, setVisibleLimit] = useState(RUNS_PAGE_SIZE);
  const runs = useAutomationRuns(automation.id, visibleLimit + 1);
  const visibleRuns = useMemo(
    () => runs.data?.slice(0, visibleLimit) ?? [],
    [runs.data, visibleLimit]
  );
  const hasMoreRuns = Boolean(runs.data && runs.data.length > visibleLimit);

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
        ) : visibleRuns.length ? (
          <>
            <ul className="flex flex-col">
              {visibleRuns.map((run) => (
                <RunRow
                  key={run.id}
                  run={run}
                  projectId={automation.projectId}
                  onOpenTask={(taskId) =>
                    navigate('task', { projectId: automation.projectId, taskId })
                  }
                />
              ))}
            </ul>
            {hasMoreRuns ? (
              <div className="flex justify-center px-3 py-3">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={runs.isFetching}
                  onClick={() => setVisibleLimit((limit) => limit + RUNS_PAGE_SIZE)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  {runs.isFetching ? 'Loading older runs...' : 'Load older runs'}
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            No runs yet.
          </div>
        )}
      </div>
    </>
  );
}

const RunRow = observer(function RunRow({
  run,
  projectId,
  onOpenTask,
}: {
  run: AutomationRun;
  projectId: string;
  onOpenTask: (taskId: string) => void;
}) {
  const taskId = run.taskId;
  const task = taskId ? getRegisteredTaskData(projectId, taskId) : undefined;
  const interactive = Boolean(taskId && task && !task.archivedAt);
  const tooltip = interactive
    ? 'Open agent'
    : taskId
      ? 'Agent is no longer available'
      : 'This run did not create an agent';

  function handleOpenTask() {
    if (!taskId || !interactive) return;
    const taskView = getTaskView(projectId, taskId);
    taskView?.setView('agents');
    onOpenTask(taskId);
  }

  const status = formatRunStatusLabel(run.status);
  const isFailed = run.status === 'failed';

  const rowContent = (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className={cn('truncate text-sm', isFailed ? 'text-destructive' : 'text-foreground')}>
          Run from {formatRunTriggerKindLabel(run.triggerKind)}
        </span>
        {status ? (
          <>
            <span className="shrink-0 text-xs text-muted-foreground/50">·</span>
            <span className="shrink-0 text-xs text-muted-foreground">{status}</span>
          </>
        ) : null}
      </div>
      <RelativeTime
        value={run.startedAt}
        className="shrink-0 text-xs text-muted-foreground"
        compact
        ago
      />
      <ChevronRight
        className={cn(
          'size-3.5 shrink-0 transition-transform',
          interactive
            ? 'text-muted-foreground/50 group-hover:translate-x-0.5 group-hover:text-foreground'
            : 'text-muted-foreground/20'
        )}
      />
    </>
  );

  return (
    <li>
      <Tooltip>
        <TooltipTrigger render={<div />}>
          {interactive ? (
            <button
              type="button"
              onClick={handleOpenTask}
              className="group flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-muted/30 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {rowContent}
            </button>
          ) : (
            <div className="flex cursor-not-allowed items-center gap-3 rounded-md px-3 py-2.5 opacity-60">
              {rowContent}
            </div>
          )}
        </TooltipTrigger>
        <TooltipContent side="left">{tooltip}</TooltipContent>
      </Tooltip>
      {run.error && (
        <p className="mx-3 mb-2 mt-0.5 line-clamp-2 text-xs text-destructive">{run.error}</p>
      )}
    </li>
  );
});
