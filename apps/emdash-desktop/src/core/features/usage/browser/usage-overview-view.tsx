import { EmptyState } from '@emdash/ui/react/components';
import { PageLayout } from '@emdash/ui/react/patterns';
import { Button, Icon } from '@emdash/ui/react/primitives';
import type { UsageOverview } from '../api/schemas';
import { UsageAccountSection } from './usage-account-section';

export function UsageOverviewView({
  overview,
  loading,
  refreshing,
  error,
  onRefresh,
  onMachines,
}: {
  overview?: UsageOverview;
  loading: boolean;
  refreshing: boolean;
  error?: string;
  onRefresh(): void;
  onMachines(): void;
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
  const machinesNeedingAttention =
    overview?.machines.filter(
      (machine) =>
        ['disconnected', 'upgrade-required', 'error'].includes(machine.status) ||
        machine.providers.some((provider) =>
          ['signed-out', 'unavailable'].includes(provider.status)
        )
    ).length ?? 0;
  return (
    <div className="space-y-8 pb-4">
      <PageLayout.Header
        sticky
        title="Usage"
        description="Your subscription limits."
        actions={
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={onRefresh}
              disabled={loading || busy}
              aria-label="Refresh usage"
            >
              <Icon name="rotate-cw" size="sm" />
              {busy ? 'Refreshing…' : 'Refresh'}
            </Button>
          </div>
        }
      />
      {(error ?? overview?.error) && (
        <p role="alert" className="text-sm text-foreground-destructive">
          {error ?? overview?.error}
        </p>
      )}
      {accounts.length ? (
        accounts.map((account) => {
          const number = (counts.get(account.providerId) ?? 0) + 1;
          counts.set(account.providerId, number);
          return <UsageAccountSection key={account.key} view={account} number={number} />;
        })
      ) : (
        <EmptyState
          label={loading || busy ? 'Discovering accounts…' : 'No subscription accounts found'}
          description="Sign in with Codex or Claude Code on a connected machine, then refresh."
        />
      )}
      <div className="flex flex-wrap items-center gap-3 text-xs text-foreground-muted">
        <Button variant="link" onClick={onMachines}>
          Manage machines
        </Button>
        {machinesNeedingAttention > 0 && (
          <span>
            {machinesNeedingAttention === 1
              ? '1 machine needs attention'
              : `${machinesNeedingAttention} machines need attention`}
          </span>
        )}
      </div>
    </div>
  );
}
