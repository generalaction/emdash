import { EmptyState } from '@emdash/ui/react/components';
import { PageLayout } from '@emdash/ui/react/patterns';
import { Button, Icon } from '@emdash/ui/react/primitives';
import type { UsageOverview } from '../api/schemas';
import { UsageAccountSection, usageAccountTitle } from './usage-account-section';

export function UsageOverviewView({
  overview,
  loading,
  refreshing,
  error,
  onRefresh,
}: {
  overview?: UsageOverview;
  loading: boolean;
  refreshing: boolean;
  error?: string;
  onRefresh(): void;
}) {
  const busy =
    refreshing ||
    (overview?.machines.some(
      (machine) =>
        machine.status === 'checking' ||
        (machine.status === 'connected' &&
          machine.providers.some((provider) => provider.refreshing))
    ) ??
      false);
  const order = (provider: string) => (provider === 'codex' ? 0 : provider === 'claude' ? 1 : 2);
  const accounts = [...(overview?.accounts ?? [])].sort(
    (a, b) => order(a.providerId) - order(b.providerId)
  );
  const counts = new Map<string, number>();
  return (
    <div className="space-y-8 pb-4">
      <PageLayout.Header
        sticky
        title="Usage"
        description="Your subscription limits."
        titleActions={
          <Button
            variant="secondary"
            size="sm"
            onClick={onRefresh}
            disabled={loading || busy}
            aria-label="Refresh usage"
          >
            <Icon name="rotate-cw" size="sm" />
            {busy ? 'Refreshing…' : 'Refresh'}
          </Button>
        }
      />
      {(error ?? overview?.error) && (
        <p role="alert" className="text-sm text-foreground-destructive">
          {error ?? overview?.error}
        </p>
      )}
      {accounts.length ? (
        accounts.map((account) => {
          const title = usageAccountTitle(account);
          const number = (counts.get(title) ?? 0) + 1;
          counts.set(title, number);
          return (
            <UsageAccountSection
              key={account.key}
              view={account}
              title={number === 1 ? title : `${title} (${number})`}
            />
          );
        })
      ) : (
        <EmptyState
          label={loading || busy ? 'Discovering accounts…' : 'No subscription accounts found'}
          description="Sign in with Codex or Claude Code on a connected machine, then refresh."
        />
      )}
    </div>
  );
}
