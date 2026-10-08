import {
  USAGE_CACHE_MS,
  usageAccountIdentity,
  type HostUsage,
  type ProviderUsage,
} from '@emdash/core/primitives/provider-usage/api';
import type { UsageAccountView, UsageMachine, UsageOverview } from '../api/schemas';

/** Only main projects account identity across hosts. Percentages are never added together. */
export function aggregateUsage(machines: UsageMachine[], now: number): UsageOverview {
  const accounts = new Map<string, UsageAccountView>();
  const selected = new Map<string, { observedAt: number; stale: boolean }>();
  for (const machine of machines) {
    for (const reading of machine.providers) {
      const account = reading.account;
      if (!account || (!account.email && !account.id && reading.windows.length === 0)) continue;
      const identity = usageAccountIdentity(account);
      // An email alone cannot identify a business workspace. Keep uncertain scopes separate.
      const ambiguous =
        !account.id &&
        !account.organization &&
        !/^(free|go|plus|pro|max(?:\s?(?:5x|20x))?)$/i.test(account.plan ?? '');
      const key = JSON.stringify([
        reading.providerId,
        identity ?? machine.id,
        ambiguous ? machine.id : '',
      ]);
      let view = accounts.get(key);
      if (!view) {
        view = {
          key,
          providerId: reading.providerId,
          account,
          sources: [],
          windows: [],
          message: reading.message,
        };
        accounts.set(key, view);
      }
      view.sources.push({
        machineId: machine.id,
        machineName: machine.name,
        status: machine.status === 'connected' ? reading.status : machine.status,
        refreshing: machine.status === 'connected' && reading.refreshing,
      });
      const observedAt = reading.observedAt;
      if (observedAt === null) continue;
      const stale =
        machine.status !== 'connected' ||
        reading.status !== 'ready' ||
        now - observedAt > USAGE_CACHE_MS + 45_000;
      const existing = selected.get(key);
      if (
        existing &&
        (existing.observedAt > observedAt ||
          (existing.observedAt === observedAt && (!existing.stale || stale)))
      )
        continue;
      // Probes return complete snapshots. The newest inventory can remove old model windows.
      selected.set(key, { observedAt, stale });
      view.account = account;
      view.message = reading.message;
      view.windows = reading.windows.map((window) => ({
        ...window,
        observedAt,
        sourceName: machine.name,
        stale,
      }));
    }
  }
  return {
    accounts: [...accounts.values()].sort(
      (a, b) =>
        a.providerId.localeCompare(b.providerId) ||
        (a.account.email ?? '').localeCompare(b.account.email ?? '') ||
        a.key.localeCompare(b.key)
    ),
    // Wire freezes published state in development. Keep mutable inventory shells private.
    machines: machines.map((machine) => ({ ...machine })),
  };
}

/** Translate host-relative age onto the desktop clock; a future-dated host must not win forever. */
export function receiveUsage(snapshot: HostUsage, receivedAt: number): ProviderUsage[] {
  const translate = (time: number | null) =>
    time === null ? null : receivedAt - Math.max(0, snapshot.sampledAt - time);
  return snapshot.providers.map((provider) => ({
    ...provider,
    observedAt: translate(provider.observedAt),
    checkedAt: translate(provider.checkedAt),
  }));
}
