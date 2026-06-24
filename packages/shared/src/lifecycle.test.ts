import { describe, expect, it } from 'vitest';
import { toPendingLease, withLease, type Lease } from './lifecycle';

function leaseFor<T>(value: T, onRelease: () => void | Promise<void>): Lease<T> {
  return {
    value,
    release: async () => {
      await onRelease();
    },
  };
}

describe('withLease', () => {
  it('releases the lease after a successful operation', async () => {
    let released = false;

    const result = await withLease(
      leaseFor('value', () => {
        released = true;
      }),
      (value) => value.toUpperCase()
    );

    expect(result).toBe('VALUE');
    expect(released).toBe(true);
  });

  it('releases the lease when the operation throws', async () => {
    let released = false;

    await expect(
      withLease(
        Promise.resolve(
          leaseFor('value', () => {
            released = true;
          })
        ),
        () => {
          throw new Error('failed');
        }
      )
    ).rejects.toThrow('failed');

    expect(released).toBe(true);
  });
});

describe('toPendingLease', () => {
  it('supports releasing before the lease promise resolves', async () => {
    let resolve!: (lease: Lease<string>) => void;
    let released = false;
    const leasePromise = new Promise<Lease<string>>((res) => {
      resolve = res;
    });

    const lease = toPendingLease(leasePromise);
    const release = lease.release();

    resolve(
      leaseFor('value', () => {
        released = true;
      })
    );

    await release;
    expect(released).toBe(true);
  });

  it('exposes readiness separately from release', async () => {
    const lease = toPendingLease(Promise.resolve(leaseFor('value', () => {})));

    await expect(lease.ready()).resolves.toBe('value');
    await expect(lease.release()).resolves.toBeUndefined();
  });
});
