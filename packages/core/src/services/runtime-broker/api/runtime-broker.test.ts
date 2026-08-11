import { err, ok } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import { LOCAL_HOST_REF, hostRef } from '../../../primitives/host/api';
import { RuntimeBroker, type HostRuntimesClient } from './runtime-broker';

describe('RuntimeBroker', () => {
  it('delegates client resolution without owning the returned resource', async () => {
    const client = {} as HostRuntimesClient;
    const resolve = vi.fn(() => ok(client));
    const broker = new RuntimeBroker({ resolve });

    await expect(broker.client(LOCAL_HOST_REF)).resolves.toEqual(ok(client));
    await expect(broker.client(LOCAL_HOST_REF)).resolves.toEqual(ok(client));
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it('returns typed host resolution failures as client values', async () => {
    const remote = hostRef('remote', 'remote-1');
    const broker = new RuntimeBroker({
      resolve: (host) =>
        err({
          type: 'host-unavailable',
          host,
          message: 'Remote runtime sessions are not enabled',
        }),
    });

    await expect(broker.client(remote)).resolves.toEqual(
      err({
        type: 'host-unavailable',
        host: remote,
        message: 'Remote runtime sessions are not enabled',
      })
    );
  });

  it('delegates invalidation when the resolver has lifecycle state below it', async () => {
    const invalidate = vi.fn(async () => {});
    const broker = new RuntimeBroker({
      resolve: () => ok({} as HostRuntimesClient),
      invalidate,
    });

    await broker.invalidate(LOCAL_HOST_REF);

    expect(invalidate).toHaveBeenCalledWith(LOCAL_HOST_REF);
  });
});
