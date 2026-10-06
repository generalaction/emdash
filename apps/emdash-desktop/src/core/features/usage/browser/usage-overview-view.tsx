import { EmptyState } from '@emdash/ui/react/components';
import {
  CollectionView,
  PageLayout,
  SettingsCard,
  SettingsSection,
} from '@emdash/ui/react/patterns';
import { AbsoluteTime, Badge, Button, Meter, RelativeTime } from '@emdash/ui/react/primitives';
import type { UsageAccountView, UsageMachine, UsageOverview } from '../api/schemas';

const providerName = (id: string) =>
  id === 'claude' ? 'Claude Code' : id === 'codex' ? 'Codex' : id;
const statusLabel: Record<string, string> = {
  ready: 'Up to date',
  loading: 'Checking',
  'signed-out': 'Signed out',
  unsupported: 'Limits unavailable',
  unavailable: 'Unavailable',
  'missing-cli': 'Not installed',
  connected: 'Connected',
  disconnected: 'Offline',
  checking: 'Checking',
  'upgrade-required': 'Server update required',
  error: 'Unavailable',
};

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
  const accounts = overview?.accounts ?? [];
  return (
    <div className="space-y-8 pb-4">
      <PageLayout.Header
        sticky
        title="Usage"
        description="Subscription limits for accounts signed in on your machines. Shared accounts appear once."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={onRefresh} disabled={loading || busy}>
              {busy ? 'Refreshing…' : 'Refresh usage'}
            </Button>
            <Button onClick={onMachines}>Manage machines</Button>
            <span className="text-muted-foreground text-xs">
              Updates every 5 minutes while open
            </span>
          </div>
        }
      />
      {(error ?? overview?.error) && (
        <p role="alert" className="text-destructive text-sm">
          {error ?? overview?.error}
        </p>
      )}
      <SettingsSection title="Accounts" bare>
        {accounts.length ? (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {accounts.map((account) => (
              <AccountCard key={account.key} view={account} />
            ))}
          </div>
        ) : (
          <EmptyState
            label={loading || busy ? 'Discovering accounts…' : 'No subscription accounts found'}
            description="Sign in with Codex or Claude Code on a connected machine, then refresh usage."
          />
        )}
      </SettingsSection>
      <SettingsSection title="Machines" bare>
        <CollectionView
          items={overview?.machines ?? []}
          getItemKey={(machine) => machine.id}
          renderRow={(machine) => <MachineRow machine={machine} />}
          emptySlot={
            <EmptyState bare label={loading ? 'Discovering machines…' : 'No machines available'} />
          }
        />
        <p className="text-muted-foreground mt-3 text-xs">
          Connect remote machines from Manage machines to discover their accounts. API keys and
          third-party providers may not report subscription limits.
        </p>
      </SettingsSection>
    </div>
  );
}

function AccountCard({ view }: { view: UsageAccountView }) {
  const refreshing = view.sources.some((source) => source.refreshing);
  return (
    <SettingsCard>
      <div className="space-y-5">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{providerName(view.providerId)}</span>
            {view.account.plan && <Badge>{view.account.plan}</Badge>}
            {refreshing && <Badge>Refreshing</Badge>}
          </div>
          <p className="text-sm break-all">
            {view.account.email ?? 'Account identity unavailable'}
          </p>
          {view.account.organization && (
            <p className="text-muted-foreground text-xs">{view.account.organization}</p>
          )}
        </div>
        {view.windows.length ? (
          view.windows.map((window) => {
            const remaining = window.usedPercent === null ? null : 100 - window.usedPercent;
            const display =
              remaining === null ? 'Unknown' : `${Number(remaining.toFixed(1))}% remaining`;
            return (
              <div key={window.id} className="space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span>{window.label}</span>
                  <span className="font-medium tabular-nums">{display}</span>
                </div>
                {remaining !== null && (
                  <Meter
                    label={`${window.label} remaining`}
                    value={remaining}
                    aria-valuetext={display}
                    tone={remaining <= 10 ? 'error' : remaining <= 25 ? 'warning' : 'neutral'}
                  />
                )}
                <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span>
                    {window.resetsAt === null ? (
                      'Reset time unavailable'
                    ) : (
                      <>
                        Reset <AbsoluteTime value={window.resetsAt} />
                      </>
                    )}
                  </span>
                  {window.stale && <Badge tone="warning">Stale</Badge>}
                </div>
                <p className="text-muted-foreground text-xs">
                  Read <RelativeTime value={window.observedAt} /> · {window.sourceName}
                </p>
              </div>
            );
          })
        ) : (
          <p className="text-muted-foreground text-sm">
            {view.message ?? 'Subscription limits are unavailable.'}
          </p>
        )}
        <div className="flex flex-wrap gap-2" aria-label="Account machines">
          {view.sources.map((source) => (
            <Badge key={source.machineId} variant="outline">
              {source.machineName} · {statusLabel[source.status] ?? source.status}
            </Badge>
          ))}
        </div>
      </div>
    </SettingsCard>
  );
}

function MachineRow({ machine }: { machine: UsageMachine }) {
  return (
    <div className="w-full space-y-2 py-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">{machine.name}</span>
        <Badge
          tone={
            machine.status === 'upgrade-required' || machine.status === 'error'
              ? 'warning'
              : 'neutral'
          }
        >
          {statusLabel[machine.status]}
        </Badge>
      </div>
      <div className="text-muted-foreground space-y-1 text-xs">
        {machine.status === 'disconnected' ? (
          <p>Connect this machine to read current usage.</p>
        ) : machine.status === 'upgrade-required' ? (
          <p>Update the workspace server to read usage on this machine.</p>
        ) : (
          machine.providers.map((provider) => (
            <p key={provider.providerId}>
              {providerName(provider.providerId)} ·{' '}
              {provider.refreshing ? 'Checking' : statusLabel[provider.status]}
              {provider.message ? ` — ${provider.message}` : ''}
            </p>
          ))
        )}
      </div>
    </div>
  );
}
