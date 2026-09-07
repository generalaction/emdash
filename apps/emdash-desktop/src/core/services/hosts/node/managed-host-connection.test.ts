import { createScope } from '@emdash/shared/concurrency';
import { deferred } from '@emdash/shared/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFaultPeer, createSupervisorDriver } from './testing/connection-supervisor-fixture';

describe('ManagedHostConnection intent', () => {
  let peer: ReturnType<typeof createFaultPeer>;
  let driver: ReturnType<typeof createSupervisorDriver>;
  let owners: ReturnType<typeof createScope>;
  beforeEach(() => {
    vi.useFakeTimers();
    peer = createFaultPeer();
    driver = createSupervisorDriver(peer);
    owners = createScope();
  });
  afterEach(async () => {
    await owners.dispose();
    await driver.dispose();
    await peer.dispose();
    vi.useRealTimers();
  });

  it('acknowledges a pin while connection establishment remains pending', async () => {
    const release = peer.stallInitialize();
    await expect(driver.managed.pin()).resolves.toEqual({ success: true, data: undefined });
    await vi.advanceTimersByTimeAsync(0);
    expect(driver.state.kind).not.toBe('ready');
    release();
    await driver.managed.supervisor.awaitUsable();
    expect(driver.state.kind).toBe('ready');
  });

  it('maintains the runtime until the last lease is released', async () => {
    const first = owners.child();
    const second = owners.child();
    driver.managed.lease(first);
    driver.managed.lease(second);
    await vi.advanceTimersByTimeAsync(0);
    expect(driver.state.kind).toBe('ready');
    await first.dispose();
    expect(peer.current.closed).toBe(false);
    await second.dispose();
    expect(peer.current.closed).toBe(true);
    expect(driver.state.kind).not.toBe('ready');
  });

  it('retains a pin after all leases end', async () => {
    driver.managed.lease(owners);
    await driver.managed.pin();
    await vi.advanceTimersByTimeAsync(0);
    await owners.dispose();
    expect(driver.state.kind).toBe('ready');
    expect(peer.current.closed).toBe(false);
  });

  it('does not register interest for an already disposed owner', async () => {
    await owners.dispose();
    driver.managed.lease(owners);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(peer.opens).toBe(0);
  });

  it('keeps existing and new leases suppressed after Disconnect until a pin', async () => {
    driver.managed.lease(owners.child());
    await vi.advanceTimersByTimeAsync(0);
    await expect(driver.managed.disconnect()).resolves.toMatchObject({ success: true });
    const opens = peer.opens;
    driver.managed.lease(owners.child());
    driver.supervisor.resume();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(peer.opens).toBe(opens);
    expect(driver.state.kind).toBe('suspended');
    await driver.managed.pin();
    await vi.advanceTimersByTimeAsync(0);
    expect(driver.state.kind).toBe('ready');
  });

  it('serializes a pending pin before Disconnect without reactivating the stopped connection', async () => {
    await driver.dispose();
    const gate = deferred<void>();
    const writes: boolean[] = [];
    driver = createSupervisorDriver(peer, {
      intent: {
        read: async () => false,
        write: async (enabled) => {
          writes.push(enabled);
          if (enabled) await gate.promise;
        },
      },
    });
    const pin = driver.managed.pin();
    await vi.advanceTimersByTimeAsync(0);
    const stop = driver.managed.disconnect();
    expect(driver.state.kind).toBe('suspended');
    gate.resolve();
    await expect(pin).resolves.toMatchObject({ success: false });
    await expect(stop).resolves.toMatchObject({ success: true });
    expect(writes).toEqual([true, false]);
    expect(peer.opens).toBe(0);
  });

  it('does not let a stale persisted-intent read undo Disconnect', async () => {
    await driver.dispose();
    const read = deferred<boolean>();
    driver = createSupervisorDriver(peer, {
      intent: { read: () => read.promise, write: async () => {} },
    });
    driver.managed.lease(owners);
    await driver.managed.disconnect();
    read.resolve(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(driver.state.kind).toBe('suspended');
    expect(peer.opens).toBe(0);
  });

  it('reports persistence failure as a Result while keeping recovery stopped', async () => {
    await driver.dispose();
    driver = createSupervisorDriver(peer, {
      intent: {
        read: async () => true,
        write: async (enabled) => {
          if (!enabled) throw new Error('Disk unavailable');
        },
      },
    });
    driver.managed.lease(owners);
    await vi.advanceTimersByTimeAsync(0);
    await expect(driver.managed.disconnect()).resolves.toMatchObject({
      success: false,
      error: { message: expect.stringContaining('Disk unavailable') },
    });
    expect(peer.current.closed).toBe(true);
    expect(driver.state.kind).toBe('suspended');
  });

  it('starts and releases runtime work with lease scopes', async () => {
    let lease = owners.child('lease');
    await vi.advanceTimersByTimeAsync(0);
    expect(peer.opens).toBe(0);
    driver.managed.lease(lease);
    await vi.advanceTimersByTimeAsync(0);
    expect(driver.state.kind).toBe('ready');
    await lease.dispose();
    await vi.advanceTimersByTimeAsync(0);
    expect(peer.current.closed).toBe(true);
    lease = owners.child('lease');
    driver.managed.lease(lease);
    await vi.advanceTimersByTimeAsync(0);
    expect(driver.state.kind).toBe('ready');
  });
});
