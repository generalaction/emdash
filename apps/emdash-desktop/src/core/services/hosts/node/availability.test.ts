import { LOCAL_HOST_REF, hostRef } from '@emdash/core/primitives/host/api';
import { runtimeHostUnavailable } from '@emdash/core/primitives/runtime-resolution/api';
import { err, ok } from '@emdash/shared';
import { createScope } from '@emdash/shared/concurrency';
import { deferred } from '@emdash/shared/testing';
import { describe, expect, it, vi } from 'vitest';
import { createHostAvailability } from './availability';

describe('HostAvailability', () => {
  it('does not report an SSH Host ready before its runtime handshake completes', async () => {
    const scope = createScope({ label: 'host-availability-test' });
    const handshake = deferred<void>();
    const preparing = deferred<void>();
    const availability = createHostAvailability({
      scope,
      readiness: {
        async prepare(_host, context) {
          context.setPhase('provisioning');
          preparing.resolve();
          await handshake.promise;
          context.setPhase('handshaking');
          return ok();
        },
      },
    });
    const host = hostRef('remote', 'ssh-1');

    const pending = availability.ensureReady(host, 'demand');
    await preparing.promise;

    expect(availability.stateFor(host)).toEqual({
      kind: 'preparing',
      phase: 'provisioning',
      attempt: 1,
    });
    expect(availability.requireReady(host)).toMatchObject({
      success: false,
      error: { type: 'host-unavailable', reason: 'runtime-unavailable' },
    });

    handshake.resolve();

    await expect(pending).resolves.toEqual({
      success: true,
      data: { host, generation: 1 },
    });
    expect(availability.stateFor(host)).toEqual({ kind: 'ready', generation: 1 });

    await scope.dispose();
  });

  it('rejects a stale success after suspension and a newer readiness cycle', async () => {
    const scope = createScope({ label: 'host-availability-test' });
    const first = deferred<ReturnType<typeof ok<void>>>();
    const second = deferred<ReturnType<typeof ok<void>>>();
    const prepare = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const availability = createHostAvailability({
      scope,
      readiness: { prepare },
    });
    const host = hostRef('remote', 'ssh-1');

    const stale = availability.ensureReady(host, 'demand');
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
    availability.suspend(host);
    const current = availability.ensureReady(host, 'retry');
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(2));
    second.resolve(ok());
    await expect(current).resolves.toEqual({
      success: true,
      data: { host, generation: 1 },
    });

    first.resolve(ok());

    await expect(stale).resolves.toMatchObject({
      success: false,
      error: { type: 'host-unavailable', reason: 'offline' },
    });
    expect(availability.stateFor(host)).toEqual({ kind: 'ready', generation: 1 });

    await scope.dispose();
  });

  it('coalesces concurrent readiness requests into one Host attempt', async () => {
    const scope = createScope({ label: 'host-availability-test' });
    const completion = deferred<ReturnType<typeof ok<void>>>();
    const prepare = vi.fn(() => completion.promise);
    const availability = createHostAvailability({
      scope,
      readiness: { prepare },
    });
    const host = hostRef('remote', 'ssh-1');

    const first = availability.ensureReady(host, 'demand');
    const second = availability.ensureReady(host, 'demand');

    expect(second).toBe(first);
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
    completion.resolve(ok());
    await expect(first).resolves.toMatchObject({ success: true });

    await scope.dispose();
  });

  it('keeps requireReady read-only and preserves a recorded semantic failure', async () => {
    const scope = createScope({ label: 'host-availability-test' });
    const host = hostRef('remote', 'ssh-1');
    const failure = runtimeHostUnavailable(
      host,
      'install-failed',
      'Host runtime installation failed'
    );
    const prepare = vi.fn(async () => err(failure));
    const availability = createHostAvailability({
      scope,
      readiness: { prepare },
    });

    expect(availability.requireReady(host)).toEqual(
      err(runtimeHostUnavailable(host, 'offline', 'Host is offline'))
    );
    expect(prepare).not.toHaveBeenCalled();

    await expect(availability.ensureReady(host, 'demand')).resolves.toEqual(err(failure));
    expect(availability.requireReady(host)).toEqual(err(failure));
    expect(prepare).toHaveBeenCalledOnce();

    await scope.dispose();
  });

  it('cancels in-flight preparation when the Host is suspended', async () => {
    const scope = createScope({ label: 'host-availability-test' });
    const started = deferred<void>();
    const prepare = vi.fn(
      async (
        _host: unknown,
        { signal }: { signal: AbortSignal }
      ): Promise<ReturnType<typeof ok<void>>> => {
        started.resolve();
        return await new Promise<ReturnType<typeof ok<void>>>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      }
    );
    const availability = createHostAvailability({
      scope,
      readiness: { prepare },
    });
    const host = hostRef('remote', 'ssh-1');

    const pending = availability.ensureReady(host, 'demand');
    await started.promise;
    availability.suspend(host);

    await expect(pending).resolves.toMatchObject({
      success: false,
      error: { type: 'host-unavailable', reason: 'offline' },
    });
    expect(availability.stateFor(host)).toEqual({
      kind: 'suspended',
      reason: 'user-disconnected',
    });

    await scope.dispose();
  });

  it('supports local runtime readiness and advances the generation after a fresh cycle', async () => {
    const scope = createScope({ label: 'host-availability-test' });
    const handshake = deferred<void>();
    const availability = createHostAvailability({
      scope,
      readiness: {
        async prepare() {
          await handshake.promise;
          return ok();
        },
      },
    });

    const first = availability.ensureReady(LOCAL_HOST_REF, 'demand');
    expect(availability.stateFor(LOCAL_HOST_REF)).toEqual({
      kind: 'preparing',
      phase: 'handshaking',
      attempt: 1,
    });
    handshake.resolve();
    await expect(first).resolves.toMatchObject({ success: true, data: { generation: 1 } });

    availability.suspend(LOCAL_HOST_REF);
    await expect(availability.ensureReady(LOCAL_HOST_REF, 'retry')).resolves.toMatchObject({
      success: true,
      data: { generation: 2 },
    });

    await scope.dispose();
  });

  it('lets one explicit request supersede automatic preparation and then single-flights clicks', async () => {
    const scope = createScope({ label: 'host-availability-test' });
    const automatic = deferred<ReturnType<typeof ok<void>>>();
    const explicit = deferred<ReturnType<typeof ok<void>>>();
    const prepare = vi
      .fn()
      .mockImplementationOnce(() => automatic.promise)
      .mockImplementationOnce(() => explicit.promise);
    const availability = createHostAvailability({
      scope,
      readiness: { prepare },
    });
    const host = hostRef('remote', 'ssh-1');

    const superseded = availability.ensureReady(host, 'demand');
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
    const current = availability.ensureReady(host, 'retry');
    const repeated = availability.ensureReady(host, 'retry');

    expect(current).not.toBe(superseded);
    expect(repeated).toBe(current);
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(2));
    explicit.resolve(ok());
    await expect(current).resolves.toMatchObject({ success: true });
    automatic.resolve(ok());
    await expect(superseded).resolves.toMatchObject({
      success: false,
      error: { type: 'host-unavailable', reason: 'runtime-unavailable' },
    });

    await scope.dispose();
  });

  it.each([
    ['connection-failed', 'eligible'],
    ['install-failed', 'manual'],
    ['unsupported-platform', 'blocked'],
  ] as const)('classifies %s readiness failures as %s recovery', async (reason, recovery) => {
    const scope = createScope({ label: 'host-availability-test' });
    const host = hostRef('remote', 'ssh-1');
    const issue = runtimeHostUnavailable(host, reason, `semantic:${reason}`);
    const availability = createHostAvailability({
      scope,
      readiness: { prepare: async () => err(issue) },
    });

    await availability.ensureReady(host, 'demand');

    expect(availability.stateFor(host)).toEqual({
      kind: 'unavailable',
      issue,
      recovery,
    });

    await scope.dispose();
  });

  it('keeps manual and blocked failures dormant until an explicit request', async () => {
    const scope = createScope({ label: 'host-availability-test' });
    const host = hostRef('remote', 'ssh-1');
    const blocked = runtimeHostUnavailable(
      host,
      'unsupported-platform',
      'Host platform is not supported'
    );
    const prepare = vi.fn().mockResolvedValueOnce(err(blocked)).mockResolvedValueOnce(ok());
    const availability = createHostAvailability({
      scope,
      readiness: { prepare },
    });

    await availability.ensureReady(host, 'demand');
    await expect(availability.ensureReady(host, 'online')).resolves.toEqual(err(blocked));
    expect(prepare).toHaveBeenCalledOnce();

    await expect(availability.ensureReady(host, 'retry')).resolves.toMatchObject({
      success: true,
    });
    expect(prepare).toHaveBeenCalledTimes(2);

    await scope.dispose();
  });
});
