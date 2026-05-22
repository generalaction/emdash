import { History } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Automation } from '@shared/automations/types';
import { Button } from '@renderer/lib/ui/button';
import { Spinner } from '@renderer/lib/ui/spinner';
import { useAutomationRunActions } from '../use-automation-run-actions';
import { useAutomationRuns } from '../useAutomations';
import { AutomationRunRow } from './AutomationRunRow';

const RUNS_PAGE_SIZE = 15;

interface RunHistoryProps {
  automation: Automation;
}

export function RunHistory({ automation }: RunHistoryProps) {
  const [visibleLimit, setVisibleLimit] = useState(RUNS_PAGE_SIZE);
  const runs = useAutomationRuns(automation.id, visibleLimit + 1);
  const { deleteRun, rerunFrom } = useAutomationRunActions();
  const visibleRuns = useMemo(
    () => runs.data?.slice(0, visibleLimit) ?? [],
    [runs.data, visibleLimit]
  );
  const hasMore = Boolean(runs.data && runs.data.length > visibleLimit);
  const canRerun = !automation.isDraft && automation.projectId != null;

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <History className="size-3 text-muted-foreground" />
        <h3 className="text-xs font-medium text-muted-foreground">Run history</h3>
      </div>
      {runs.isPending ? (
        <div className="flex h-24 items-center justify-center">
          <Spinner />
        </div>
      ) : visibleRuns.length > 0 ? (
        <div className="divide-y divide-border/70 overflow-hidden rounded-md border border-border">
          {visibleRuns.map((run) => (
            <AutomationRunRow
              key={run.id}
              run={run}
              automation={automation}
              projectId={automation.projectId}
              title={automation.name}
              paddingClass="px-3"
              onDelete={deleteRun}
              onRerun={canRerun ? () => rerunFrom(automation.id) : undefined}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
          No runs yet.
        </div>
      )}
      {hasMore ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={runs.isFetching}
          onClick={() => setVisibleLimit((limit) => limit + RUNS_PAGE_SIZE)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {runs.isFetching ? 'Loading older runs…' : 'Load older runs'}
        </Button>
      ) : null}
    </section>
  );
}
