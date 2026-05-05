import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Automation } from '@shared/automations/types';
import { Button } from '@renderer/lib/ui/button';
import { Spinner } from '@renderer/lib/ui/spinner';
import { useAutomationRuns } from '../useAutomations';
import { AutomationRunRow } from './AutomationRunRow';

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
            <div className="divide-y divide-border/70">
              {visibleRuns.map((run) => (
                <AutomationRunRow
                  key={run.id}
                  run={run}
                  automation={automation}
                  projectId={automation.projectId}
                  title={automation.name}
                />
              ))}
            </div>
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
