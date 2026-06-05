import { History } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Spinner } from '@renderer/lib/ui/spinner';
import type { Automation } from '@shared/automations/types';
import { useAutomationRunActions } from '../use-automation-run-actions';
import { useAutomationRuns } from '../useAutomations';
import { AutomationRunRow } from './AutomationRunRow';

const INITIAL_RUNS_LIMIT = 50;
const RUNS_LOAD_MORE_SIZE = 25;

interface RunHistoryProps {
  automation: Automation;
}

export function RunHistory({ automation }: RunHistoryProps) {
  const [visibleLimit, setVisibleLimit] = useState(INITIAL_RUNS_LIMIT);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadMoreLockRef = useRef(false);

  const runs = useAutomationRuns(automation.id, visibleLimit + 1);
  const { deleteRun, rerunFrom, forceCancel } = useAutomationRunActions();
  const visibleRuns = useMemo(
    () => runs.data?.slice(0, visibleLimit) ?? [],
    [runs.data, visibleLimit]
  );
  const hasMore = Boolean(runs.data && runs.data.length > visibleLimit);
  const canRerun = !automation.isDraft && automation.projectId != null;
  const isLoadingMore = runs.isFetching && !runs.isPending;

  useEffect(() => {
    setVisibleLimit(INITIAL_RUNS_LIMIT);
  }, [automation.id]);

  useEffect(() => {
    if (!runs.isFetching) loadMoreLockRef.current = false;
  }, [runs.isFetching]);

  useEffect(() => {
    if (!hasMore || runs.isFetching) return;

    const root = scrollRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        if (loadMoreLockRef.current || runs.isFetching) return;
        loadMoreLockRef.current = true;
        setVisibleLimit((limit) => limit + RUNS_LOAD_MORE_SIZE);
      },
      { root, rootMargin: '120px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, runs.isFetching, visibleRuns.length]);

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <History className="text-muted-foreground size-3" />
        <h3 className="text-muted-foreground text-xs font-medium">Run history</h3>
      </div>
      {runs.isPending ? (
        <div className="flex h-24 items-center justify-center">
          <Spinner />
        </div>
      ) : visibleRuns.length > 0 ? (
        <div
          ref={scrollRef}
          className="max-h-80 divide-y divide-border/70 overflow-y-auto rounded-md border border-border"
        >
          {visibleRuns.map((run) => (
            <AutomationRunRow
              key={run.id}
              run={run}
              automation={automation}
              projectId={automation.projectId}
              title={automation.name}
              onDelete={deleteRun}
              onForceCancel={forceCancel}
              onRerun={canRerun ? () => rerunFrom(automation.id) : undefined}
            />
          ))}
          {hasMore ? (
            <div
              ref={sentinelRef}
              className="flex h-10 items-center justify-center"
              aria-hidden={!isLoadingMore}
            >
              {isLoadingMore ? <Spinner className="size-4" /> : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="text-muted-foreground rounded-md border border-dashed border-border px-3 py-6 text-center text-xs">
          No runs yet.
        </div>
      )}
    </section>
  );
}
