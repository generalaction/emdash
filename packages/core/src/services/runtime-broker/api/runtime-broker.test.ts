import { err, ok } from '@emdash/shared';
import { createScope } from '@emdash/shared/concurrency';
import { describe, expect, it, vi } from 'vitest';
import { LOCAL_HOST_REF, hostRef } from '../../../primitives/host/api';
import { RuntimeBroker, type HostRuntimesClient } from './runtime-broker';

describe('RuntimeBroker', () => {
  it('coalesces sessions and keeps the resource until the last lease releases', async () => {
    const disposed = vi.fn();
    const client = {} as HostRuntimesClient;
    const resolve = vi.fn((_host, scope) => {
      scope.add(disposed);
      return ok(client);
    });
    const broker = new RuntimeBroker({ resolve });

    const first = broker.session(LOCAL_HOST_REF);
    const second = broker.session(LOCAL_HOST_REF);

    expect(await first.ready()).toEqual(ok(client));
    expect(await second.ready()).toEqual(ok(client));
    expect(resolve).toHaveBeenCalledTimes(1);

    await first.release();
    expect(disposed).not.toHaveBeenCalled();
    await second.release();
    expect(disposed).toHaveBeenCalledTimes(1);
  });

  it('returns typed host resolution failures as session values', async () => {
    const remote = hostRef('remote', 'remote-1');
    const broker = new RuntimeBroker({
      resolve: (host) =>
        err({
          type: 'host-unavailable',
          host,
          message: 'Remote runtime sessions are not enabled',
        }),
    });

    const lease = broker.session(remote);
    expect(await lease.ready()).toEqual(
      err({
        type: 'host-unavailable',
        host: remote,
        message: 'Remote runtime sessions are not enabled',
      })
    );
    await lease.release();
  });

  it('retries after a failed Result session instead of retaining it', async () => {
    const remote = hostRef('remote', 'remote-1');
    const client = {} as HostRuntimesClient;
    const failedCleanup = vi.fn();
    let attempts = 0;
    const resolve = vi.fn((host, scope) => {
      attempts += 1;
      if (attempts > 1) return ok(client);
      scope.add(failedCleanup);
      return err({
        type: 'host-unavailable' as const,
        host,
        message: 'Remote runtime is temporarily unavailable',
      });
    });
    const broker = new RuntimeBroker({ resolve, idleTtlMs: 30_000 });

    const failed = broker.session(remote);
    expect(await failed.ready()).toEqual(
      err({
        type: 'host-unavailable',
        host: remote,
        message: 'Remote runtime is temporarily unavailable',
      })
    );
    expect(broker.peek(remote)).toBeUndefined();
    expect(failedCleanup).toHaveBeenCalledTimes(1);

    const recovered = broker.session(remote);
    expect(await recovered.ready()).toEqual(ok(client));
    expect(resolve).toHaveBeenCalledTimes(2);
    await failed.release();
    await recovered.release();
    await broker.dispose();
  });

  it('disposes session resources with its parent scope', async () => {
    const parent = createScope({ label: 'test-runtime-broker' });
    const disposed = vi.fn();
    const broker = new RuntimeBroker({
      scope: parent,
      resolve: (_host, scope) => {
        scope.add(disposed);
        return ok({} as HostRuntimesClient);
      },
    });
    const lease = broker.session(LOCAL_HOST_REF);
    await lease.ready();

    await parent.dispose();

    expect(disposed).toHaveBeenCalledTimes(1);
    await lease.release();
  });
});
