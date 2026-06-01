import { RotateCw } from 'lucide-react';
import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { Titlebar } from '@renderer/lib/components/titlebar/Titlebar';
import { useParams } from '@renderer/lib/layout/navigation-provider';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { Spinner } from '@renderer/lib/ui/spinner';
import { cn } from '@renderer/utils/utils';
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
  return (
    <Titlebar
      leftSlot={
        <div className="flex items-center px-2">
          <span className="text-sm text-foreground-muted">Usage</span>
        </div>
      }
    />
  );
}

export function UsageMainPanel() {
  const { tab, onTabChange } = useUsageTab();
  const { snapshot, isLoading, isError, refresh, isRefreshing, refetch } = useUsageSnapshot();

  const hasData = snapshot.totals.sessions > 0 || snapshot.daily.length > 0;

  return (
    <div className="relative z-10 flex min-h-0 flex-1 overflow-hidden bg-background">
      <div className="mx-auto grid h-full min-h-0 w-full max-w-[1060px] grid-cols-[13rem_minmax(0,1fr)] gap-8 px-8">
        <div className="py-10">
          <nav className="flex min-h-0 w-52 flex-col gap-0.5 overflow-y-auto">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onTabChange(item.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-normal text-foreground-muted transition-colors hover:bg-background-1 hover:text-foreground',
                  item.id === tab &&
                    'bg-background-2 text-foreground hover:bg-background-2 hover:text-foreground'
                )}
              >
                {item.label}
              </button>
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 justify-start gap-2 px-3 text-foreground-muted"
              onClick={() => refresh()}
              disabled={isRefreshing}
            >
              {isRefreshing ? <Spinner size="sm" /> : <RotateCw className="h-3.5 w-3.5" />}
              Refresh
            </Button>
          </nav>
        </div>

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto py-10">
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
          ) : tab === 'overview' ? (
            <OverviewTab snapshot={snapshot} />
          ) : (
            <CostsTab snapshot={snapshot} />
          )}
        </div>
      </div>
    </div>
  );
}

export const usageView = {
  WrapView: UsageViewWrapper,
  TitlebarSlot: UsageTitlebar,
  MainPanel: UsageMainPanel,
};
