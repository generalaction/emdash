import { RotateCw } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { Spinner } from '@renderer/lib/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import { CostsTab } from './costs-tab';
import { OverviewTab } from './overview-tab';
import { useUsageSnapshot } from './use-usage-snapshot';

type Tab = 'overview' | 'costs';

const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'costs', label: 'Costs' },
];

export function UsagePanel() {
  const [tab, setTab] = useState<Tab>('overview');
  const { snapshot, isLoading, isError, refetch, refresh, isRefreshing } = useUsageSnapshot();

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        label="Couldn't load usage"
        description="Something went wrong reading your transcripts."
        action={
          <Button variant="secondary" size="sm" onClick={() => void refetch()}>
            Try again
          </Button>
        }
      />
    );
  }

  const hasData = snapshot.totals.sessions > 0 || snapshot.daily.length > 0;
  if (!hasData) {
    return (
      <EmptyState
        label="No usage yet"
        description="No local AI coding agent usage was found on this machine."
      />
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-background-1 p-1">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={cn(
                'rounded-md px-3 py-1 text-sm transition-colors',
                item.id === tab
                  ? 'bg-background-3 font-medium text-foreground shadow-sm'
                  : 'text-foreground-muted hover:text-foreground'
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger>
              <button
                type="button"
                onClick={() => refresh()}
                disabled={isRefreshing}
                aria-label="Refresh usage"
                className="flex size-7 items-center justify-center rounded-md text-foreground/50 transition-colors hover:bg-background-2 hover:text-foreground disabled:opacity-50"
              >
                <RotateCw className={cn('h-4 w-4', isRefreshing && 'animate-spin')} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Refresh</TooltipContent>
          </Tooltip>
        </div>
      </div>
      {tab === 'overview' ? <OverviewTab snapshot={snapshot} /> : <CostsTab snapshot={snapshot} />}
    </div>
  );
}
