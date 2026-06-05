import { Clock } from 'lucide-react';
import { useEffect, useState } from 'react';
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
import { useAutomationRunsPaginated, useScheduledAutomationRun } from '../use-automations';
import { AutomationRunRow } from './AutomationRunRow';

const PAGE_SIZE = 25;

interface RunHistoryProps {
  automation: Automation;
}

export function RunHistory({ automation }: RunHistoryProps) {
  const [page, setPage] = useState(0);

  useEffect(() => {
    setPage(0);
  }, [automation.id]);

  const scheduledRunQuery = useScheduledAutomationRun(automation.id);
  const runsQuery = useAutomationRunsPaginated(automation.id, page);

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
      {runsQuery.isPending ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : historyRuns.length > 0 ? (
        <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-border/70 rounded-md border border-border">
          {historyRuns.map((run) => (
            <AutomationRunRow key={run.id} runId={run.id} automationId={automation.id} />
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
