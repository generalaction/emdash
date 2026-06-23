import { describe, expect, it } from 'vitest';
import { ResourceMap } from './resource-map';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('ResourceMap', () => {
  it('shares one provision across concurrent acquires of the same key', async () => {
    let provisions = 0;
    const torndown: string[] = [];
    const map = new ResourceMap<string>({
      teardown: (key) => {
        torndown.push(key);
      },
    });

    const gate = deferred<string>();
    const provision = () => {
      provisions += 1;
      return gate.promise;
    };
    const [a, b] = [map.acquire('k', provision), map.acquire('k', provision)];
    gate.resolve('value');
    const [leaseA, leaseB] = await Promise.all([a, b]);

    expect(provisions).toBe(1);
    expect(leaseA.value).toBe('value');
    expect(leaseB.value).toBe('value');

    leaseA.release();
    leaseA.release(); // idempotent
    expect(torndown).toEqual([]);
    leaseB.release();
    await new Promise((resolve) => setImmediate(resolve));
    expect(torndown).toEqual(['k']);
    expect(map.idle).toBe(true);
  });

  it('rejects all waiters and evicts the entry when provisioning fails', async () => {
    const map = new ResourceMap<string>({ teardown: () => {} });
    const failing = () => Promise.reject(new Error('provision failed'));

    await expect(map.acquire('k', failing)).rejects.toThrow('provision failed');
    expect(map.idle).toBe(true);

    // A fresh acquire provisions again rather than reusing the poisoned entry.
    const lease = await map.acquire('k', async () => 'recovered');
    expect(lease.value).toBe('recovered');
    lease.release();
  });

  it('waits for an in-flight teardown before re-provisioning the same key', async () => {
    const order: string[] = [];
    const teardownGate = deferred<void>();
    const map = new ResourceMap<string>({
      teardown: async () => {
        order.push('teardown:start');
        await teardownGate.promise;
        order.push('teardown:end');
      },
    });

    const first = await map.acquire('k', async () => 'one');
    first.release();

    const second = map.acquire('k', async () => {
      order.push('provision:two');
      return 'two';
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(order).toEqual(['teardown:start']);

    teardownGate.resolve();
    const lease = await second;
    expect(order).toEqual(['teardown:start', 'teardown:end', 'provision:two']);
    expect(lease.value).toBe('two');
    lease.release();
  });

  it('tears down when the last lease releases while provisioning succeeded late', async () => {
    const torndown: string[] = [];
    const map = new ResourceMap<string>({
      teardown: (_key, value) => {
        torndown.push(value);
      },
    });
    const gate = deferred<string>();

    const pending = map.acquire('k', () => gate.promise);
    gate.resolve('late');
    const lease = await pending;
    lease.release();
    await new Promise((resolve) => setImmediate(resolve));
    expect(torndown).toEqual(['late']);
  });

  it('reports teardown errors through onError', async () => {
    const errors: Array<{ context: string; error: unknown }> = [];
    const map = new ResourceMap<string>({
      teardown: () => {
        throw new Error('teardown failed');
      },
      onError: (context, error) => errors.push({ context, error }),
    });

    const lease = await map.acquire('k', async () => 'value');
    lease.release();
    await new Promise((resolve) => setImmediate(resolve));

    expect(errors).toHaveLength(1);
    expect(errors[0]!.context).toBe('teardown k');
  });

  it('rejects new acquires after dispose while existing leases stay usable', async () => {
    let emptied = 0;
    const map = new ResourceMap<string>({
      teardown: () => {},
      onEmpty: () => {
        emptied += 1;
      },
    });

    const lease = await map.acquire('k', async () => 'value');
    map.dispose();

    expect(lease.value).toBe('value');
    await expect(map.acquire('other', async () => 'x')).rejects.toThrow('ResourceMap disposed');

    lease.release();
    await new Promise((resolve) => setImmediate(resolve));
    expect(emptied).toBe(1);
    expect(map.idle).toBe(true);
  });
});
