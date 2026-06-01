import { RotateCw } from 'lucide-react';
import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { useParams } from '@renderer/lib/layout/navigation-provider';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { Spinner } from '@renderer/lib/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { cn } from '@renderer/utils/utils';
import { DedupBadge } from './components/DedupBadge';
import { CostsTab } from './costs-tab';
import { OverviewTab } from './overview-tab';
import { useUsageSnapshot } from './use-usage-snapshot';

export type UsageTab = 'overview' | 'costs';

const tabs: Array<{ id: UsageTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'costs', label: 'Costs' },
];

const UsageTabContext = createContext<{ tab: UsageTab; onTabChange: (t: UsageTab) => void }>({
  tab: 'overview',
  onTabChange: () => {},
});

export function UsageViewWrapper({
  children,
  tab = 'overview',
}: {
  children: ReactNode;
  tab?: UsageTab;
}) {
  const { setParams } = useParams('usage');
  const onTabChange = useCallback((next: UsageTab) => setParams({ tab: next }), [setParams]);
  return (
    <UsageTabContext.Provider value={{ tab, onTabChange }}>{children}</UsageTabContext.Provider>
  );
}

function useUsageTab() {
  return useContext(UsageTabContext);
}

export function UsageTitlebar() {
  // Shares the React Query cache with the main panel (same query key).
  const { refresh, isRefreshing } = useUsageSnapshot();
  return (
    <Titlebar
      leftSlot={
        <div className="flex items-center px-2">
          <span className="text-sm text-foreground-muted">Usage</span>
        </div>
      }
      rightSlot={
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
      }
    />
  );
}

export function UsageMainPanel() {
  const { tab, onTabChange } = useUsageTab();
  const { snapshot, isLoading, isError, refetch } = useUsageSnapshot();

  const hasData = snapshot.totals.sessions > 0 || snapshot.daily.length > 0;

  return (
    <div className="relative z-10 flex min-h-0 flex-1 justify-center overflow-y-auto bg-background">
      <div className="w-full max-w-[1200px] px-8 py-8">
        {isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Spinner />
          </div>
        ) : isError ? (
          <EmptyState
            label="Couldn't load usage"
            description="Something went wrong reading your transcripts."
            action={
              <Button variant="secondary" size="sm" onClick={() => void refetch()}>
                Try again
              </Button>
            }
          />
        ) : !hasData ? (
          <EmptyState
            label="No usage yet"
            description="No Claude Code or Codex usage was found on this machine."
          />
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between">
              <div className="inline-flex items-center gap-0.5 rounded-md border border-border bg-background p-0.5">
                {tabs.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onTabChange(item.id)}
                    className={cn(
                      'rounded px-3 py-1 text-sm transition-colors',
                      item.id === tab
                        ? 'bg-muted text-foreground'
                        : 'text-foreground-muted hover:text-foreground'
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <DedupBadge />
            </div>
            {tab === 'overview' ? (
              <OverviewTab snapshot={snapshot} />
            ) : (
              <CostsTab snapshot={snapshot} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

export const usageView = {
  WrapView: UsageViewWrapper,
  TitlebarSlot: UsageTitlebar,
  MainPanel: UsageMainPanel,
};
