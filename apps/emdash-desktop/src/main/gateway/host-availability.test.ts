import { LOCAL_HOST_REF, hostRef } from '@emdash/core/primitives/host/api';
import { createScope } from '@emdash/shared/concurrency';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostService } from '@core/services/hosts/node/host-service';
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
    fixture.availability.demand(remoteHost, 'automatic', fixture.scope);
    fixture.availability.wakeDemanded('online');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fixture.availability.stateFor(remoteHost).kind).toBe('suspended');
    expect(fixture.peer.opens).toBe(opens);
  });
});

function createFixture() {
  const scope = createScope({ label: 'desktop-supervisor-test' });
  const peer = createFaultPeer();
  const driver = createSupervisorDriver(peer);
  const supervisor = driver.supervisor;
  const localReady = vi.fn(async () => {});
  // Gateway ports only are substituted; the supervisor and Wire protocol are real.
  const hosts = {
    connection: () => supervisor.control,
    availability: () => supervisor.availability,
    demand: (_id, mode, owner) => supervisor.demand(mode, owner),
    wake: (cause) => {
      if (cause === 'resume') supervisor.resume();
      else if (cause === 'suspend') supervisor.suspendSystem();
      else supervisor.revalidate(cause);
    },
    onReady: () => () => {},
    onInvalidate: () => () => {},
  } satisfies Pick<
    HostService,
    'connection' | 'availability' | 'demand' | 'wake' | 'onReady' | 'onInvalidate'
  >;
  const availability = createDesktopHostAvailability({
    scope,
    hosts,
    runtimes: { rebind: vi.fn(), forget: vi.fn() },
    localReady,
  });
  return { scope, peer, driver, availability, localReady };
}
