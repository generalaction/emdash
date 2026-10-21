import type { Scope } from '@emdash/shared/concurrency';
import { runWithTimeout, systemClock, type Clock } from '@emdash/shared/scheduling';
import { cell, expose } from '@emdash/wire/state';
import {
  USAGE_CACHE_MS,
  type HostUsage,
  type ProviderUsage,
  type UsageProbeResult,
  usageProbeSchema,
} from '#primitives/provider-usage/api';
import { providerUsageContract } from '../api';

export type UsageProbe = {
  providerId: string;
  read(
    signal: AbortSignal
  ): Promise<UsageProbeResult | { status: 'missing-cli'; windows: []; message: string }>;
};

/** One cache and in-flight request per provider, shared by every attached desktop. */
export class ProviderUsageRuntime {
  private readonly readings = new Map<string, ProviderUsage>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly state = cell<HostUsage>({ sampledAt: 0, providers: [] });
  private activeScope: Scope | undefined;
  readonly snapshotHost;

  constructor(
    private readonly scope: Scope,
    private readonly probes: UsageProbe[],
    private readonly clock: Clock = systemClock
  ) {
    for (const { providerId } of probes)
      this.readings.set(providerId, {
        providerId,
        status: 'loading',
        refreshing: false,
        windows: [],
        checkedAt: null,
        observedAt: null,
      });
    this.publish();
    this.snapshotHost = expose(
      providerUsageContract.snapshot,
      {
        current: (_key, demand) => {
          this.publish();
          this.activeScope = demand;
          demand.add(() => {
            if (this.activeScope === demand) this.activeScope = undefined;
          });
          demand.run('usage-refresh', async (signal) => {
            while (!signal.aborted) {
              await this.refresh(false, demand);
              await this.clock.sleep(USAGE_CACHE_MS, { signal, unref: true });
            }
          });
          return this.state;
        },
      },
      { scope, lingerMs: 15_000, clock }
    );
  }

  async refresh(force = true, owner = this.activeScope ?? this.scope): Promise<void> {
    await Promise.all(this.probes.map((probe) => this.refreshProvider(probe, force, owner)));
  }

  private refreshProvider(probe: UsageProbe, force: boolean, owner: Scope): Promise<void> {
    const pending = this.inFlight.get(probe.providerId);
    if (pending) return pending;
    const previous = this.readings.get(probe.providerId);
    if (!previous || owner.disposed) return Promise.resolve();
    // Manual refresh bypasses the cache, but repeated clicks cannot hammer providers.
    if (
      previous.checkedAt !== null &&
      this.clock.now() - previous.checkedAt < (force ? 10_000 : USAGE_CACHE_MS)
    )
      return Promise.resolve();
    this.readings.set(probe.providerId, { ...previous, refreshing: true });
    this.publish();
    const work = runWithTimeout(probe.read, {
      timeoutMs: 35_000,
      signal: owner.signal,
      clock: this.clock,
    })
      .then((result) => (result.status === 'missing-cli' ? result : usageProbeSchema.parse(result)))
      .catch(
        (): UsageProbeResult => ({
          status: 'unavailable',
          windows: [],
          message: 'Could not read usage from this machine. Try refreshing.',
        })
      )
      .then((result) => {
        if (owner.disposed) {
          this.readings.set(probe.providerId, { ...previous, refreshing: false });
          return;
        }
        const account = 'account' in result ? result.account : undefined;
        // Failed reads may preserve a known account; a confirmed switch or sign-out must clear it.
        const sameAccount =
          !account ||
          (previous.account &&
            (account.id
              ? account.id === previous.account.id
              : account.email === previous.account.email) &&
            account.organization === previous.account.organization &&
            account.plan === previous.account.plan);
        const retain = result.status === 'unavailable' && sameAccount;
        this.readings.set(probe.providerId, {
          ...result,
          providerId: probe.providerId,
          refreshing: false,
          account: retain ? previous.account : account,
          windows: retain ? previous.windows : result.windows,
          observedAt: retain
            ? previous.observedAt
            : result.status === 'ready'
              ? this.clock.now()
              : null,
          checkedAt: this.clock.now(),
        });
      })
      .finally(() => {
        this.inFlight.delete(probe.providerId);
        this.publish();
      });
    this.inFlight.set(probe.providerId, work);
    return work;
  }

  private publish(): void {
    this.state.set({ sampledAt: this.clock.now(), providers: [...this.readings.values()] });
  }
}
