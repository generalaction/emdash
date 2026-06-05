import { Clock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@renderer/utils/utils';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@renderer/lib/components/pagination';
import { AbsoluteTime } from '@renderer/lib/ui/absolute-time';
import { Spinner } from '@renderer/lib/ui/spinner';
import type { Automation } from '@shared/automations/automation';
import {
  useAutomationRunCounts,
  useAutomationRunsPaginated,
  useScheduledAutomationRun,
} from '../use-automations';
import { AutomationRunRow } from './AutomationRunRow';

const PAGE_SIZE = 25;

type FilterOption = 'all' | 'done' | 'failed' | 'skipped';

const FILTERS: { value: FilterOption; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'done', label: 'Done' },
  { value: 'failed', label: 'Failed' },
  { value: 'skipped', label: 'Skipped' },
];

interface RunHistoryProps {
  automation: Automation;
}

export function RunHistory({ automation }: RunHistoryProps) {
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<FilterOption>('all');

  useEffect(() => {
    setPage(0);
  }, [automation.id, filter]);

  const statusFilter = filter === 'all' ? undefined : filter;
  const scheduledRunQuery = useScheduledAutomationRun(automation.id);
  const runsQuery = useAutomationRunsPaginated(automation.id, page, statusFilter);
  const countsQuery = useAutomationRunCounts(automation.id);

  const counts = countsQuery.data;
  const scheduledRun = scheduledRunQuery.data ?? null;
  const allRuns = runsQuery.data ?? [];
  const historyRuns = allRuns.slice(0, PAGE_SIZE);
  const hasNextPage = !runsQuery.isPlaceholderData && allRuns.length > PAGE_SIZE;
  const hasPrevPage = page > 0;

  return (
    <section className="flex h-full flex-col gap-2">
      {scheduledRun?.scheduledAt && (
        <div className=" p-2 flex items-center gap-1.5 bg-background-info text-foreground-info rounded-lg border border-border-info">

          <Clock className="size-3 shrink-0" aria-hidden />
          Next run scheduled <AbsoluteTime value={scheduledRun.scheduledAt} />
        </div>
    
      )}
      <div className="flex gap-1.5 w-full">
        {FILTERS.map(({ value, label }) => {
          const count = counts ? counts[value] : undefined;
          return (
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
              {count !== undefined && (
                <span className={cn('tabular-nums', filter === value ? 'text-foreground-muted' : 'text-foreground-passive')}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {runsQuery.isPending ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : historyRuns.length > 0 ? (
        <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-border/70 rounded-md border border-border">
          {historyRuns.map((run) => (
            <AutomationRunRow key={run.id} runId={run.id} automationId={automation.id} run={run} />
          ))}
        </div>
      ) : (
        <div className="text-muted-foreground rounded-md border border-dashed border-border px-3 py-6 text-center text-xs">
          No runs yet.
        </div>
      )}
      {(hasPrevPage || hasNextPage) && (
        <Pagination className="py-1">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                onClick={hasPrevPage ? () => setPage((p) => p - 1) : undefined}
                aria-disabled={!hasPrevPage}
                className={!hasPrevPage ? 'pointer-events-none opacity-50' : ''}
              />
            </PaginationItem>
            <PaginationItem>
              <span className="px-2 text-xs text-foreground-muted">Page {page + 1}</span>
            </PaginationItem>
            <PaginationItem>
              <PaginationNext
                onClick={hasNextPage ? () => setPage((p) => p + 1) : undefined}
                aria-disabled={!hasNextPage}
                className={!hasNextPage ? 'pointer-events-none opacity-50' : ''}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </section>
  );
}
