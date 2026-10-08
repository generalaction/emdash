import type { ProviderUsage } from '@emdash/core/primitives/provider-usage/api';
import { describe, expect, it } from 'vitest';
import type { UsageMachine } from '../api/schemas';
import { aggregateUsage, receiveUsage } from './aggregate';

const reading = (patch: Partial<ProviderUsage> = {}): ProviderUsage => ({
  providerId: 'claude',
  status: 'ready',
  refreshing: false,
  account: { email: 'one@example.com', organization: 'org-1', plan: 'pro' },
  windows: [{ id: 'weekly', label: 'Weekly', usedPercent: 10, resetsAt: null }],
  checkedAt: 1000,
  observedAt: 1000,
  ...patch,
});
const machine = (
  id: string,
  provider: ProviderUsage,
  status: UsageMachine['status'] = 'connected'
): UsageMachine => ({ id, name: id, status, providers: [provider] });

describe('desktop usage aggregation', () => {
  it('compares elapsed host age instead of trusting machine wall clocks', () => {
    const providers = receiveUsage(
      {
        sampledAt: 9_000_000,
        providers: [reading({ observedAt: 8_940_000, checkedAt: 9_000_000 })],
      },
      100_000
    );
    expect(providers[0]).toMatchObject({ observedAt: 40_000, checkedAt: 100_000 });
  });

  it('does not resurrect a removed model bucket from an older complete snapshot', () => {
    const old = reading({
      windows: [{ id: 'model', label: 'Model', usedPercent: 90, resetsAt: null }],
    });
    const latest = reading({ observedAt: 2000 });
    const result = aggregateUsage([machine('old', old), machine('new', latest)], 3000);
    expect(result.accounts[0]?.windows.map((window) => window.id)).toEqual(['weekly']);
  });
  it('deduplicates across machines and selects the newest window without summing', () => {
    const overview = aggregateUsage(
      [
        machine('laptop', reading()),
        machine(
          'server',
          reading({
            account: { email: 'ONE@example.com', organization: 'org-1', plan: 'pro' },
            observedAt: 2000,
            windows: [{ id: 'weekly', label: 'Weekly', usedPercent: 25, resetsAt: null }],
          })
        ),
      ],
      3000
    );
    expect(overview.accounts).toHaveLength(1);
    expect(overview.accounts[0]?.sources).toHaveLength(2);
    expect(overview.accounts[0]?.windows[0]).toMatchObject({
      usedPercent: 25,
      sourceName: 'server',
      stale: false,
    });
  });
  it('keeps providers, organizations, ambiguous business accounts and anonymous identities separate', () => {
    const inputs = [
      machine('one', reading()),
      machine('two', reading({ providerId: 'codex' })),
      machine(
        'three',
        reading({ account: { email: 'one@example.com', organization: 'org-2', plan: 'pro' } })
      ),
      machine('four', reading({ account: { email: 'one@example.com', plan: 'team' } })),
      machine('five', reading({ account: { email: 'one@example.com', plan: 'team' } })),
      machine('six', reading({ account: {} })),
      machine('seven', reading({ account: {} })),
    ];
    expect(aggregateUsage(inputs, 3000).accounts).toHaveLength(7);
  });
  it('marks failures and disconnections stale without changing the reported utilization after reset', () => {
    const source = reading({
      status: 'unavailable',
      windows: [{ id: 'weekly', label: 'Weekly', usedPercent: 100, resetsAt: 2000 }],
    });
    const result = aggregateUsage([machine('offline', source, 'disconnected')], 5000);
    expect(result.accounts[0]?.windows[0]).toMatchObject({ usedPercent: 100, stale: true });
  });
  it('ages old readings and drops accounts when the host confirms sign-out', () => {
    expect(aggregateUsage([machine('one', reading())], 400000).accounts[0]?.windows[0]?.stale).toBe(
      true
    );
    expect(
      aggregateUsage(
        [machine('one', reading({ status: 'signed-out', account: undefined, windows: [] }))],
        5000
      ).accounts
    ).toEqual([]);
  });
});
