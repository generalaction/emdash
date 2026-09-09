import { LOCAL_HOST_REF, hostRef } from '@emdash/core/primitives/host/api';
import { runtimeHostUnavailable } from '@emdash/core/primitives/runtime-resolution/api';
import { err, ok } from '@emdash/shared';
import { createScope } from '@emdash/shared/concurrency';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Hosts } from '@core/services/hosts/node/hosts';
import {
  createSupervisorDriver,
  createFaultPeer,
} from '@core/services/hosts/node/testing/connection-supervisor-fixture';
import { createDesktopHostAvailability } from './host-availability';

describe('desktop Host availability supervisor projection', () => {
  const remoteHost = hostRef('remote', 'host');
  let fixture: ReturnType<typeof createFixture>;
  beforeEach(() => {
    vi.useFakeTimers();
    fixture = createFixture();
  });
  afterEach(async () => {
    await fixture.scope.dispose();
    await fixture.driver.dispose();
    await fixture.peer.dispose();
    vi.useRealTimers();
  });

  it('retains independent local worker readiness', async () => {
    await expect(fixture.availability.ensureReady(LOCAL_HOST_REF, 'demand')).resolves.toMatchObject(
      { success: true }
    );
    expect(fixture.localReady).toHaveBeenCalledOnce();
    expect(fixture.peer.opens).toBe(0);
  });

  it('keeps a readiness wait on the identity captured before pinning', async () => {
    const original = fixture.hosts.get(remoteHost);
    if (!original) throw new Error('Expected remote Host fixture');
    const issue = runtimeHostUnavailable(remoteHost, 'offline', 'Host identity was replaced');
    const oldWait = vi.fn(async () => err(issue));
    const replacementWait = vi.fn(async () => ok({ host: remoteHost, generation: 99 }));
    const get = vi.spyOn(fixture.hosts, 'get');
    get.mockReturnValue({ ...original, runtime: { ...original.runtime, waitUntilReady: oldWait } });
    vi.spyOn(original.connection, 'pin').mockImplementation(async () => {
      get.mockReturnValue({
        ...original,
        runtime: { ...original.runtime, waitUntilReady: replacementWait },
      });
      return ok();
    });
    await expect(fixture.availability.ensureReady(remoteHost, 'connect')).resolves.toEqual(
      err(issue)
    );
    expect(oldWait).toHaveBeenCalledOnce();
    expect(replacementWait).not.toHaveBeenCalled();
    expect(fixture.localReady).not.toHaveBeenCalled();
  });

  it('does not prepare local workers when remote intent registration fails', async () => {
    const issue = runtimeHostUnavailable(remoteHost, 'offline', 'Remote is unavailable');
    vi.spyOn(fixture.driver.managed, 'pin').mockResolvedValue(err(issue));
    await expect(fixture.availability.ensureReady(remoteHost, 'connect')).resolves.toEqual(
      err(issue)
    );
    expect(fixture.localReady).not.toHaveBeenCalled();
    expect(fixture.peer.opens).toBe(0);
  });

  it('publishes readiness only after current initialization', async () => {
    const release = fixture.peer.stallInitialize();
    const ready = fixture.availability.ensureReady(remoteHost, 'connect');
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.availability.requireReady(remoteHost).success).toBe(false);
    release();
    await vi.advanceTimersByTimeAsync(0);
    await expect(ready).resolves.toMatchObject({ success: true });
    expect(fixture.availability.stateFor(remoteHost)).toEqual(fixture.driver.state);
  });

  it.each(['online', 'focus'] as const)('does not trust cached ready after %s', async (cause) => {
    await fixture.availability.ensureReady(remoteHost, 'connect');
    fixture.peer.current.dropReplies = true;
    fixture.peer.setOffline(true);
    fixture.availability.wakeDemanded(cause);
    expect(fixture.availability.stateFor(remoteHost)).toMatchObject({
      kind: 'preparing',
      phase: 'checking',
    });
    await vi.advanceTimersByTimeAsync(5_001);
    expect(fixture.availability.requireReady(remoteHost).success).toBe(false);
  });

  it('keeps disconnected intent authoritative over automatic demand', async () => {
    await fixture.availability.ensureReady(remoteHost, 'connect');
    await fixture.driver.disconnect();
    const opens = fixture.peer.opens;
    fixture.availability.lease(remoteHost, fixture.scope);
    fixture.availability.wakeDemanded('online');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fixture.availability.stateFor(remoteHost).kind).toBe('suspended');
    expect(fixture.peer.opens).toBe(opens);
  });

  it('acquires and releases connection leases without coupling observation to intent', async () => {
    const project = fixture.scope.child('project');
    let lease = project.child('lease');
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.peer.opens).toBe(0);
    fixture.availability.lease(remoteHost, lease);
    await fixture.availability.ensureReady(remoteHost, 'demand');
    expect(fixture.peer.opens).toBe(1);
    await lease.dispose();
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.peer.current.closed).toBe(true);
    lease = project.child('lease');
    fixture.availability.lease(remoteHost, lease);
    await fixture.availability.ensureReady(remoteHost, 'demand');
    expect(fixture.peer.opens).toBe(2);
    await project.dispose();
    fixture.availability.lease(remoteHost, lease);
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.peer.current.closed).toBe(true);
    expect(fixture.peer.opens).toBe(2);
  });
});

function createFixture() {
  const scope = createScope({ label: 'desktop-supervisor-test' });
  const peer = createFaultPeer();
  const driver = createSupervisorDriver(peer);
  const supervisor = driver.supervisor;
  const localReady = vi.fn(async () => {});
  // Gateway ports only are substituted; the supervisor and Wire protocol are real.
  const hosts: Pick<
    Hosts,
    'get' | 'availability' | 'lease' | 'wake' | 'revalidate' | 'onReady' | 'onInvalidate'
  > = {
    get: () => ({
      host: hostRef('remote', 'host'),
      connection: driver.managed,
      server: {} as never,
      runtime: {
        client: async () => {
          await supervisor.awaitUsable();
          return supervisor.attachment;
        },
        waitUntilReady: async () => {
          return ok({
            host: hostRef('remote', 'host'),
            generation: await supervisor.awaitUsable(),
          });
        },
      },
    }),
    availability: () => supervisor.availability,
    lease: (_id, owner) => driver.managed.lease(owner),
    revalidate: (_id, cause) => supervisor.revalidate(cause),
    wake: (cause) => {
      if (cause === 'resume') supervisor.resume();
      else if (cause === 'suspend') supervisor.suspendSystem();
      else supervisor.revalidate(cause);
    },
    onReady: () => () => {},
    onInvalidate: () => () => {},
  };
  const availability = createDesktopHostAvailability({
    scope,
    hosts,
    runtimes: { rebind: vi.fn(), forget: vi.fn() },
    localReady,
  });
  return { scope, peer, driver, hosts, availability, localReady };
}
