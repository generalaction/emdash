import type { HostRef } from '@emdash/core/primitives/host/api';
import type { HostUsage } from '@emdash/core/primitives/provider-usage/api';
import { providerUsageContract } from '@emdash/core/runtimes/provider-usage/api';
import type { HostRuntimesClient } from '@emdash/core/services/runtime-broker/api';
import { ok } from '@emdash/shared';
import { createScope } from '@emdash/shared/concurrency';
import { waitFor } from '@emdash/shared/testing';
import { createController } from '@emdash/wire/rpc';
import { cell, expose, observe, peek, remote } from '@emdash/wire/state';
import { createTestWire } from '@emdash/wire/testing';
import { describe, expect, it, vi } from 'vitest';
import type { MachinesService } from '@core/features/machines/api/node/machines-service';
import type { HostAvailabilityState, HostInvalidation } from '@core/services/hosts/api';
import type { HostService } from '@core/services/hosts/api/node/host-service';
import { usageContract } from '../api/contract';
import { createUsageWireController } from './wire-controller';

describe('Usage Wire overview', () => {
  it('observes only ready compatible hosts, streams deduped readings and clears forgotten identities', async () => {
    const scope = createScope({ label: 'usage-controller-test' });
    const now = Date.now();
    const usage: HostUsage = {
      sampledAt: now,
      providers: [
        {
          providerId: 'claude',
          status: 'ready',
          refreshing: false,
          checkedAt: now,
          observedAt: now,
          account: { email: 'one@example.com', organization: 'org-1', plan: 'pro' },
          windows: [{ id: 'weekly', label: 'Weekly', usedPercent: 25, resetsAt: null }],
        },
      ],
    };
    const source = cell(usage);
    const hostWire = createTestWire(
      providerUsageContract,
      createController(providerUsageContract, {
        snapshot: expose(
          providerUsageContract.snapshot,
          { current: source },
          { scope: scope.child('host') }
        ),
        refresh: vi.fn(),
      })
    );
    const availability = {
      local: cell<HostAvailabilityState>({ kind: 'ready', generation: 1 }),
      current: cell<HostAvailabilityState>({ kind: 'ready', generation: 2 }),
      legacy: cell<HostAvailabilityState>({ kind: 'ready', generation: 3 }),
      offline: cell<HostAvailabilityState>({ kind: 'suspended', reason: 'user-disconnected' }),
    };
    const state = (host: HostRef) => availability[host.id as keyof typeof availability];
    let inventory = ['current', 'legacy', 'offline'];
    let invalidate: ((event: HostInvalidation) => void) | undefined;
    let mutate: (() => void) | undefined;
    const resolve = vi.fn(async (_host: HostRef) =>
      ok({ providerUsage: hostWire.client } as HostRuntimesClient)
    );
    const getHost = vi.fn(
      (host: HostRef) =>
        ({
          runtime: {
            client: async () => ({
              currentHandshake: () => ({ agreedMinor: host.id === 'legacy' ? 0 : 1 }),
            }),
          },
        }) as HostService
    );
    const lease = vi.fn();
    const controller = createUsageWireController({
      scope,
      runtimes: { client: resolve },
      hosts: {
        get: getHost,
        onInvalidate: (listener) => {
          invalidate = listener;
          return () => {};
        },
      },
      hostAvailability: { lease, state, stateFor: (host) => peek(state(host)) },
      machines: {
        getMachines: async () =>
          inventory.map((id) => ({
            id,
            name: id,
            host: `${id}.test`,
            port: 22,
            username: 'test',
            authType: 'agent' as const,
          })),
        on: ((_name: string, handler: () => void) => {
          mutate = handler;
          return () => {};
        }) as MachinesService['on'],
      },
    });
    const wire = createTestWire(usageContract, controller);
    const view = scope.child('view');
    const model = remote(usageContract.overview, wire.client.overview, { scope: view });
    const overview = model(undefined).states.current;
    observe(overview, () => {}, { scope: view });
    try {
      await waitFor(() => peek(overview)?.accounts[0]?.sources.length === 2);
      expect(peek(overview)?.machines.find((machine) => machine.id === 'legacy')?.status).toBe(
        'upgrade-required'
      );
      expect(getHost.mock.calls.some(([host]) => host.id === 'offline')).toBe(false);
      expect(resolve.mock.calls.map(([host]) => host.id).sort()).toEqual(['current', 'local']);
      source.set({
        sampledAt: now + 1000,
        providers: usage.providers.map((provider) => ({
          ...provider,
          observedAt: now + 1000,
          windows: [{ id: 'weekly', label: 'Weekly', usedPercent: 60, resetsAt: null }],
        })),
      });
      await waitFor(() => peek(overview)?.accounts[0]?.windows[0]?.usedPercent === 60);
      availability.current.set({ kind: 'suspended', reason: 'user-disconnected' });
      await waitFor(
        () =>
          peek(overview)?.machines.find((machine) => machine.id === 'current')?.status ===
          'disconnected'
      );
      expect(peek(overview)?.accounts[0]?.sources).toHaveLength(2);
      inventory = ['legacy', 'offline'];
      invalidate?.({ connectionId: 'current', reason: 'machine-mutation' });
      mutate?.();
      await waitFor(() => peek(overview)?.accounts[0]?.sources.length === 1);
      expect(peek(overview)?.accounts[0]?.sources[0]?.machineId).toBe('local');
      expect(resolve).toHaveBeenCalledTimes(2);
      expect(lease.mock.calls.map(([host]) => host.type)).toEqual(['local']);
    } finally {
      await view.dispose();
      await wire.dispose();
      await hostWire.dispose();
      await scope.dispose();
    }
  });
});
