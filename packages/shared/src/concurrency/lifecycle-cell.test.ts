import { describe, expect, it, vi } from 'vitest';
import { ok } from '../result';
import { deferred } from '../testing';
import { createLifecycleCell } from './lifecycle-cell';

describe('LifecycleCell', () => {
  it('coalesces starts and exposes one owned value', async () => {
    const gate = deferred<{ success: true; data: { generation: number } }>();
    const start = vi.fn(async () => gate.promise);
    const cell = createLifecycleCell<void, { generation: number }, never>({
      start,
      stop: async () => ok(),
    });

    const first = cell.start();
    const second = cell.start();
    gate.resolve(ok({ generation: 1 }));

    await expect(first).resolves.toEqual(ok({ generation: 1 }));
    await expect(second).resolves.toEqual(ok({ generation: 1 }));
    expect(start).toHaveBeenCalledTimes(1);
    expect(cell.get()).toEqual({ generation: 1 });
  });

  it('interrupts before draining a lease and then clears the value', async () => {
    const order: string[] = [];
    const cell = createLifecycleCell<void, { generation: number }, never>({
      start: async () => ok({ generation: 1 }),
      interrupt: () => {
        order.push('interrupt');
      },
      stop: async () => {
        order.push('stop');
        return ok();
      },
    });
    const acquired = await cell.acquire();
    if (!acquired.success) throw new Error('expected lifecycle lease');

    const stopping = cell.stop();
    await vi.waitFor(() => expect(order).toEqual(['interrupt']));
    await acquired.data.release();
    await stopping;

    expect(order).toEqual(['interrupt', 'stop']);
    expect(cell.has()).toBe(false);
  });
});
