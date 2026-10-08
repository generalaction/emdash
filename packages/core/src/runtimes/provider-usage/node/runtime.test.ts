import { createScope } from '@emdash/shared/concurrency';
import { deferred, ManualClock, waitFor } from '@emdash/shared/testing';
import { createController } from '@emdash/wire/rpc';
import { observe, remote, snapshot } from '@emdash/wire/state';
import { createTestWire } from '@emdash/wire/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UsageProbeResult } from '#primitives/provider-usage/api';
import { providerUsageContract } from '../api';
import { ProviderUsageRuntime } from './runtime';

const good: UsageProbeResult = {
  status: 'ready',
  account: { email: 'one@example.com', plan: 'pro' },
  windows: [{ id: 'weekly', label: 'Weekly', usedPercent: 25, resetsAt: null }],
};
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});

function harness(read: (signal: AbortSignal) => Promise<UsageProbeResult>) {
  const clock = new ManualClock(1000);
  const scope = createScope({ label: 'usage-test', clock });
  const runtime = new ProviderUsageRuntime(scope, [{ providerId: 'codex', read }], clock);
  const wire = createTestWire(
    providerUsageContract,
    createController(providerUsageContract, {
      snapshot: runtime.snapshotHost,
      refresh: () => runtime.refresh(),
    })
  );
  const view = scope.child('view');
  const model = remote(providerUsageContract.snapshot, wire.client.snapshot, {
    scope: view,
    lingerMs: 15_000,
  });
  const state = model(undefined).states.current;
  cleanup.push(
    () => scope.dispose(),
    () => wire.dispose()
  );
  return {
    runtime,
    clock,
    scope,
    view,
    state,
    subscribe: () => observe(state, () => {}, { scope: view }),
    current: () => snapshot(state).value?.providers[0],
  };
}

describe('ProviderUsageRuntime', () => {
  it('probes only on demand, shares in-flight reads and enforces cache/click cooldown', async () => {
    const result = deferred<UsageProbeResult>();
    const read = vi.fn(() => result.promise);
    const h = harness(read);
    expect(read).not.toHaveBeenCalled();
    h.subscribe();
    await waitFor(() => read.mock.calls.length === 1);
    const refresh = h.runtime.refresh();
    expect(read).toHaveBeenCalledTimes(1);
    result.resolve(good);
    await refresh;
    await h.clock.advanceBy(0);
    await waitFor(() => h.current()?.status === 'ready');
    await h.runtime.refresh();
    await h.clock.advanceBy(0);
    expect(read).toHaveBeenCalledTimes(1);
    await h.clock.advanceBy(10_000);
    await h.runtime.refresh(false);
    expect(read).toHaveBeenCalledTimes(1);
    await h.runtime.refresh();
    await h.clock.advanceBy(0);
    expect(read).toHaveBeenCalledTimes(2);
    await h.view.dispose();
    await h.clock.advanceBy(16_000);
    await h.clock.advanceBy(600_000);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('retains stale readings after failure, but clears them on account switch and sign-out', async () => {
    let response = good;
    const h = harness(async () => response);
    h.subscribe();
    await waitFor(() => h.current()?.status === 'ready');
    await h.clock.advanceBy(11_000);
    response = { status: 'unavailable', windows: [] };
    await h.runtime.refresh();
    await h.clock.advanceBy(0);
    await waitFor(() => h.current()?.status === 'unavailable');
    expect(h.current()).toMatchObject({
      windows: good.windows,
      account: good.account,
      observedAt: 1000,
    });
    await h.clock.advanceBy(11_000);
    response = {
      status: 'unavailable',
      account: { email: 'two@example.com', plan: 'pro' },
      windows: [],
    };
    await h.runtime.refresh();
    await h.clock.advanceBy(0);
    await waitFor(() => h.current()?.account?.email === 'two@example.com');
    expect(h.current()?.windows).toEqual([]);
    await h.clock.advanceBy(11_000);
    response = { status: 'signed-out', windows: [] };
    await h.runtime.refresh();
    await h.clock.advanceBy(0);
    await waitFor(() => h.current()?.status === 'signed-out');
    expect(h.current()?.account).toBeUndefined();
  });

  it('cancels a hung probe when the last subscriber leaves', async () => {
    let signal: AbortSignal | undefined;
    const read = vi.fn((input: AbortSignal) => {
      signal = input;
      return new Promise<UsageProbeResult>(() => {});
    });
    const h = harness(read);
    h.subscribe();
    await waitFor(() => !!signal);
    await h.view.dispose();
    await h.clock.advanceBy(16_000);
    expect(signal?.aborted).toBe(true);
    await h.clock.advanceBy(600_000);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
