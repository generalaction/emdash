import { useState } from 'react';
import type { Automation } from '@core/primitives/automations/api';
import { Button } from '@core/primitives/ui/browser/button';
import { cn } from '@core/primitives/ui/browser/cn';
import { EmptyState } from '@core/primitives/ui/browser/empty-state';
import { Spinner } from '@core/primitives/ui/browser/spinner';
import type { RunHistoryFilter } from '../automation-run-store';
import {
  useAutomationRunCounts,
  useAutomationRunHistory,
  useAutomationTargetAvailability,
} from '../use-automations';
import { AutomationRunRow } from './AutomationRunRow';

const PAGE_SIZE = 25;

const FILTERS: { value: RunHistoryFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'done', label: 'Done' },
  { value: 'failed', label: 'Failed' },
  { value: 'skipped', label: 'Skipped' },
  { value: 'cancelled', label: 'Cancelled' },
];

interface RunHistoryProps {
  automation: Automation;
}

export function RunHistory({ automation }: RunHistoryProps) {
  const [filter, setFilter] = useState<RunHistoryFilter>('all');
  const availability = useAutomationTargetAvailability(automation.projectId);
  const runtimeAvailable = availability.data?.available === true;
  const runs = useAutomationRunHistory(automation.id, filter, PAGE_SIZE, runtimeAvailable);
  const counts = useAutomationRunCounts(automation.id, runtimeAvailable).data;

  return (
    <section className="flex h-full flex-col rounded-lg border">
      <div className="flex w-full gap-1.5 border-b p-2">
        {FILTERS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={cn(
              'flex items-center gap-1 w-full justify-center rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
              filter === value
                ? 'bg-background-2 text-foreground'
                : 'text-foreground-muted hover:bg-background-1 hover:text-foreground'
            )}
          >
            {label}
            <span
              className={cn(
                'tabular-nums',
                filter === value ? 'text-foreground-muted' : 'text-foreground-passive'
              )}
            >
              {counts[value]}
            </span>
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 divide-y divide-border/70 overflow-y-auto">
        {!runtimeAvailable ? (
          <EmptyState
            label="Connect to the remote automation runtime to load its runs."
            className="h-full"
          />
        ) : runs.isPending ? (
          <Spinner />
        ) : runs.data.length > 0 ? (
          <>
            {runs.data.map((run) => (
              <AutomationRunRow
                key={run.id}
                runId={run.id}
                automationId={automation.id}
                projectId={automation.projectId ?? null}
                run={run}
              />
            ))}
            {runs.hasMore && (
              <div className="flex justify-center p-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={runs.isLoadingMore}
                  onClick={() => void runs.loadMore()}
                >
                  {runs.isLoadingMore ? 'Loading…' : 'Load more'}
                </Button>
              </div>
            )}
          </>
        ) : (
          <EmptyState label="No runs yet." className="h-full bg-transparent" />
        )}
      </div>
    </section>
  );
}
