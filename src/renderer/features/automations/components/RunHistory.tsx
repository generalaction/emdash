import { useEffect, useState } from 'react';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@renderer/lib/components/pagination';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { Spinner } from '@renderer/lib/ui/spinner';
import { cn } from '@renderer/utils/utils';
import type { Automation } from '@shared/automations/automation';
import { useAutomationRunCounts, useAutomationRunsPaginated } from '../use-automations';
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
  const runsQuery = useAutomationRunsPaginated(automation.id, page, statusFilter);
  const countsQuery = useAutomationRunCounts(automation.id);

  const counts = countsQuery.data;
  const allRuns = runsQuery.data ?? [];
  const historyRuns = allRuns.slice(0, PAGE_SIZE);
  const hasNextPage = !runsQuery.isPlaceholderData && allRuns.length > PAGE_SIZE;
  const hasPrevPage = page > 0;

  return (
    <section className="flex h-full flex-col rounded-lg border">
      <div className="flex w-full gap-1.5 border-b p-2">
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
                <span
                  className={cn(
                    'tabular-nums',
                    filter === value ? 'text-foreground-muted' : 'text-foreground-passive'
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="min-h-0 flex-1 divide-y divide-border/70 overflow-y-auto">
        {runsQuery.isPending ? (
          <Spinner />
        ) : historyRuns.length > 0 ? (
          <>
            {historyRuns.map((run) => (
              <AutomationRunRow
                key={run.id}
                runId={run.id}
                automationId={automation.id}
                run={run}
              />
            ))}
          </>
        ) : (
          <EmptyState label="No runs yet." className="h-full bg-transparent" />
        )}
      </div>
      <Pagination className="border-t py-1">
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
    </section>
  );
}
