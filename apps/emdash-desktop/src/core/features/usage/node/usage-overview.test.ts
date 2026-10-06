import { LOCAL_HOST_REF, type HostRef } from '@emdash/core/primitives/host/api';
import type { HostUsage } from '@emdash/core/primitives/provider-usage/api';
import { providerUsageContract } from '@emdash/core/runtimes/provider-usage/api';
import type { HostRuntimesClient } from '@emdash/core/services/runtime-broker/api';
import { ok } from '@emdash/shared';
import { createScope, type Scope } from '@emdash/shared/concurrency';
import { createManualClock, deferred, waitFor } from '@emdash/shared/testing';
import { createController } from '@emdash/wire/rpc';
import { cell, expose, peek } from '@emdash/wire/state';
import { createTestWire } from '@emdash/wire/testing';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import type { MachinesService } from '@core/features/machines/api/node/machines-service';
import type { HostAvailabilityState, HostInvalidation } from '@core/services/hosts/api';
import { createUsageOverview } from './usage-overview';

function createFixture() {
  const scope = createScope({ label: 'usage-overview-test' });
  const clock = createManualClock(Date.now());
  const usage: HostUsage = {
    sampledAt: clock.now(),
    providers: [
      {
        providerId: 'claude',
        status: 'ready',
        refreshing: false,
        checkedAt: clock.now(),
        observedAt: clock.now(),
        account: { email: 'one@example.com', organization: 'org-1', plan: 'pro' },
        windows: [{ id: 'weekly', label: 'Weekly', usedPercent: 25, resetsAt: null }],
      },
    ],
  };
  const source = cell(usage);
  const refresh = vi.fn(async () => {});
  const hostWire = createTestWire(
    providerUsageContract,
    createController(providerUsageContract, {
      snapshot: expose(
        providerUsageContract.snapshot,
        { current: source },
        { scope: scope.child('host'), lingerMs: 0 }
      ),
      refresh,
    })
  );
  const availability = {
    local: cell<HostAvailabilityState>({ kind: 'ready', generation: 1 }),
    current: cell<HostAvailabilityState>({ kind: 'ready', generation: 2 }),
    offline: cell<HostAvailabilityState>({ kind: 'suspended', reason: 'user-disconnected' }),
  };
  const state = (host: HostRef) => availability[host.id as keyof typeof availability];
  const inventory = ['current', 'offline'];
  let invalidate: ((event: HostInvalidation) => void) | undefined;
  let mutate: (() => void) | undefined;
  const removeInvalidationListener = vi.fn();
  const removeMutationListener = vi.fn();
  const runtime = { providerUsage: hostWire.client } as HostRuntimesClient;
  const resolve = vi.fn(async (_host: HostRef) => ok(runtime));
  const release = vi.fn();
  const lease = vi.fn((_host: HostRef, owner: Scope) => owner.add(release));
  const getMachines = vi.fn(async () =>
    inventory.map((id) => ({
      id,
      name: id,
      host: `${id}.test`,
      port: 22,
      username: 'test',
      authType: 'agent' as const,
    }))
  );
  const overview = createUsageOverview({
    scope,
    clock,
    runtimes: { client: resolve },
    hosts: {
      onInvalidate: (listener) => {
        invalidate = listener;
        return removeInvalidationListener;
      },
    },
    hostAvailability: { lease, state, stateFor: (host) => peek(state(host)) },
    machines: {
      getMachines,
      on: ((_name: string, handler: () => void) => {
        mutate = handler;
        return removeMutationListener;
      }) as MachinesService['on'],
    },
  });
  onTestFinished(async () => {
    await scope.dispose();
    await hostWire.dispose();
  });
  return {
    scope,
    clock,
    source,
    usage,
    overview,
    availability,
    resolve,
    runtime,
    getMachines,
    lease,
    release,
    refresh,
    inventory,
    removeInvalidationListener,
    removeMutationListener,
    invalidate: (event: HostInvalidation) => invalidate?.(event),
    mutate: () => mutate?.(),
    setUsage(usedPercent: number) {
      source.set({
        sampledAt: clock.now(),
        providers: usage.providers.map((provider) => ({
          ...provider,
          observedAt: clock.now(),
          windows: [{ id: 'weekly', label: 'Weekly', usedPercent, resetsAt: null }],
        })),
      });
    },
  };
}

describe('Usage overview', () => {
  it('observes ready protocol 12 hosts without activating disconnected machines', async () => {
    const f = createFixture();
    const overview = f.overview.observe(f.scope.child('view'));
    await waitFor(() => peek(overview).accounts[0]?.sources.length === 2);
    expect(f.resolve.mock.calls.map(([host]) => host.id).sort()).toEqual(['current', 'local']);
    f.setUsage(60);
    await waitFor(() => peek(overview).accounts[0]?.windows[0]?.usedPercent === 60);
    f.availability.current.set({ kind: 'suspended', reason: 'user-disconnected' });
    await waitFor(
      () =>
        peek(overview).machines.find((machine) => machine.id === 'current')?.status ===
        'disconnected'
    );
    expect(peek(overview).accounts[0]?.sources).toHaveLength(2);
    f.inventory.splice(0, 1);
    f.invalidate({ connectionId: 'current', reason: 'machine-mutation' });
    f.mutate();
    await waitFor(() => peek(overview).accounts[0]?.sources.length === 1);
    expect(peek(overview).accounts[0]?.sources[0]?.machineId).toBe('local');
    expect(f.resolve).toHaveBeenCalledTimes(2);
    expect(f.lease.mock.calls.map(([host]) => host)).toEqual([LOCAL_HOST_REF]);
  });

  it('shares collection between observers and stops polling and refresh after the last one leaves', async () => {
    const f = createFixture();
    await f.overview.refresh();
    expect(f.getMachines).not.toHaveBeenCalled();
    expect(f.lease).not.toHaveBeenCalled();
    const first = f.scope.child('first-view');
    const second = f.scope.child('second-view');
    const overview = f.overview.observe(first);
    f.overview.observe(second);
    await waitFor(() => peek(overview).accounts[0]?.sources.length === 2);
    expect(f.lease).toHaveBeenCalledTimes(1);
    expect(f.getMachines).toHaveBeenCalledTimes(1);

    await first.dispose();
    expect(f.release).not.toHaveBeenCalled();
    await f.clock.advanceBy(60_000);
    expect(f.getMachines).toHaveBeenCalledTimes(2);
    await f.overview.refresh();
    expect(f.refresh).toHaveBeenCalledTimes(2);

    await second.dispose();
    await waitFor(() => f.release.mock.calls.length === 1);
    const inventoryReads = f.getMachines.mock.calls.length;
    await f.clock.advanceBy(120_000);
    await f.overview.refresh();
    expect(f.getMachines).toHaveBeenCalledTimes(inventoryReads);
    expect(f.refresh).toHaveBeenCalledTimes(2);
    await f.scope.dispose();
    expect(f.removeInvalidationListener).toHaveBeenCalledTimes(1);
    expect(f.removeMutationListener).toHaveBeenCalledTimes(1);
  });

  it('retains readings while idle, invalidates identities and resumes collection on reopen', async () => {
    const f = createFixture();
    const view = f.scope.child('view');
    const overview = f.overview.observe(view);
    await waitFor(() => peek(overview).accounts[0]?.sources.length === 2);
    await view.dispose();
    await waitFor(() => f.release.mock.calls.length === 1);
    f.setUsage(60);
    expect(peek(overview).accounts[0]?.windows[0]?.usedPercent).toBe(25);
    expect(peek(overview).accounts[0]?.sources).toHaveLength(2);

    f.inventory.splice(0, 1);
    f.invalidate({ connectionId: 'current', reason: 'machine-mutation' });
    f.mutate();
    expect(peek(overview).accounts[0]?.sources.map((source) => source.machineId)).toEqual([
      'local',
    ]);
    expect(f.getMachines).toHaveBeenCalledTimes(1);
    const reopened = f.overview.observe(f.scope.child('reopened'));
    await waitFor(() => peek(reopened).accounts[0]?.windows[0]?.usedPercent === 60);
    expect(f.lease).toHaveBeenCalledTimes(2);
    expect(f.resolve.mock.calls.map(([host]) => host.id)).toEqual(['local', 'current', 'local']);
  });

  it('ignores a late failure from a replaced host generation', async () => {
    const f = createFixture();
    f.availability.local.set({ kind: 'suspended', reason: 'user-disconnected' });
    const pending = deferred<HostRuntimesClient>();
    f.resolve.mockImplementationOnce(async () => ok(await pending.promise));
    const overview = f.overview.observe(f.scope.child('view'));
    await waitFor(() => f.resolve.mock.calls.length === 1);
    f.availability.current.set({ kind: 'ready', generation: 4 });
    await waitFor(() => peek(overview).accounts[0]?.sources.length === 1);
    pending.reject(new Error('Previous connection closed'));
    f.setUsage(60);
    await waitFor(() => peek(overview).accounts[0]?.windows[0]?.usedPercent === 60);
    expect(peek(overview).machines.find((machine) => machine.id === 'current')?.status).toBe(
      'connected'
    );
    await f.overview.refresh();
    expect(f.refresh).toHaveBeenCalledTimes(1);
  });

  it('preserves readings when refreshing a provider fails', async () => {
    const f = createFixture();
    const overview = f.overview.observe(f.scope.child('view'));
    await waitFor(() => peek(overview).accounts[0]?.sources.length === 2);
    f.refresh.mockRejectedValue(new Error('Provider unavailable'));
    await f.overview.refresh();
    expect(f.refresh).toHaveBeenCalledTimes(2);
    expect(peek(overview).accounts[0]?.windows[0]?.usedPercent).toBe(25);
    expect(peek(overview).accounts[0]?.windows[0]?.stale).toBe(true);
    expect(peek(overview).accounts[0]?.sources.every((source) => source.status === 'error')).toBe(
      true
    );
  });
});
