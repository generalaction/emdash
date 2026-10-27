import { hostRef } from '@emdash/core/primitives/host/api';
import { ok } from '@emdash/shared';
import { createScope } from '@emdash/shared/concurrency';
import { waitFor } from '@emdash/shared/testing';
import { cell, expose, remote, snapshot, whenReady } from '@emdash/wire/state';
import { createTestWire } from '@emdash/wire/testing';
import { describe, expect, it, vi } from 'vitest';
import { hostsContract } from '../api';
import { createHostAvailability } from './availability';
import type { Hosts } from './hosts';
import { createHostsWireController } from './wire-controller';
import { createWorkerHostAvailability } from './worker-host-availability';

describe('Hosts Wire availability', () => {
  it('publishes readiness through the Host-keyed live state', async () => {
    const scope = createScope({ label: 'hosts-wire-availability-test' });
    const workers = createWorkerHostAvailability({
      scope,
      readiness: { prepare: async () => ok() },
    });
    const host = hostRef('remote', 'ssh-1');
    const availability = createHostAvailability({
      scope,
      local: workers,
      remote: () => ({
        connection: {
          availability: workers.state(host),
          lease: (owner) => workers.lease(host, owner),
          pin: async () => ok(),
          disconnect: async () => {
            workers.suspend(host);
            return ok();
          },
        },
        waitUntilReady: () => workers.ensureReady(host, 'demand'),
      }),
      remoteState: () => workers.state(host),
      remoteLease: (_id, owner) => workers.lease(host, owner),
      wakeRemote: (cause) => workers.wakeDemanded(cause),
      revalidateRemote: () => workers.invalidate(host),
    });
    const wakeDemanded = vi.spyOn(availability, 'wakeDemanded');
    const serverStates = expose(hostsContract.serverStates, { runtime: cell({}) });
    const service = { stateModel: { host: serverStates } } as Hosts;
    const disconnect = vi.fn(async () => {
      availability.suspend(host);
    });
    const wire = createTestWire(
      hostsContract,
      createHostsWireController(service, availability, { disconnect })
    );
    const model = remote(hostsContract.availability, wire.client.availability);
    const state = model({ host }).states.state;

    expect((await whenReady(state, { scope })).value).toEqual({
      kind: 'unavailable',
      recovery: 'eligible',
    });

    await availability.ensureReady(host, 'demand');
    await waitFor(() => snapshot(state).value?.kind === 'ready');
    expect(snapshot(state).value).toEqual({
      kind: 'ready',
      generation: 1,
    });

    await wire.client.wake({ cause: 'online' });
    expect(wakeDemanded).toHaveBeenCalledWith('online');

    await wire.client.disconnect({ host: { type: 'remote', id: 'ssh-1' } });
    expect(disconnect).toHaveBeenCalledWith('ssh-1');
    await waitFor(() => snapshot(state).value?.kind === 'suspended');

    await model.dispose();
    await wire.dispose();
    await serverStates.dispose();
    await scope.dispose();
  });
});
