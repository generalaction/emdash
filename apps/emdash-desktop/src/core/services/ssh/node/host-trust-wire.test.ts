import { createScope } from '@emdash/shared/concurrency';
import { observe, remote, whenReady } from '@emdash/wire/state';
import { createTestWire } from '@emdash/wire/testing';
import { expect, it, vi } from 'vitest';
import type { SshService } from '@core/primitives/ssh/api';
import { sshContract } from '../api/contract';
import type { HostTrustRequest } from '../api/host-trust';
import { SshConnectionsModel } from './connections-model';
import { createSshWireController } from './controller';
import { HostTrustRequests } from './host-trust-requests';

it('replays pending approval over Wire, publishes cancellation, and rejects stale answers', async () => {
  const scope = createScope({ label: 'host-trust-wire-test' });
  const trust = scope.use(new HostTrustRequests());
  const connections = scope.use(new SshConnectionsModel());
  const wire = createTestWire(
    sshContract,
    createSshWireController({} as SshService, connections, trust)
  );
  const controller = new AbortController();
  const pending = trust.confirm(
    { kind: 'unknown', destination: 'work', prompt: 'SHA256:example' },
    controller.signal
  );
  let requests: HostTrustRequest[] = [];
  try {
    const model = remote(sshContract.hostTrust, wire.client.hostTrust, { scope })(undefined);
    observe(
      model.states.pending,
      (snapshot) => {
        requests = snapshot.value ?? [];
      },
      { scope }
    );
    await whenReady(model.states.pending, { scope });
    expect(requests).toHaveLength(1);
    const id = requests[0].id;
    controller.abort();
    await expect(pending).resolves.toBe(false);
    await vi.waitFor(() => expect(requests).toEqual([]));
    expect(await wire.client.respondToHostTrust({ id, accepted: true })).toBe(false);
    const next = trust.confirm(
      { kind: 'unknown', destination: 'other', prompt: 'SHA256:other' },
      new AbortController().signal
    );
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(await wire.client.respondToHostTrust({ id: requests[0].id, accepted: true })).toBe(true);
    await expect(next).resolves.toBe(true);
    await vi.waitFor(() => expect(requests).toEqual([]));
  } finally {
    await wire.dispose();
    await scope.dispose();
  }
});
