import { describe, expect, it, vi } from 'vitest';
import { deferredLiveSource } from './deferred-live-source';

describe('deferredLiveSource', () => {
  it('resolves one source and forwards snapshots and subscriptions', async () => {
    const unsubscribe = vi.fn();
    const source = {
      snapshot: vi.fn(async () => ({ generation: 1, sequence: 0, timestamp: 0, data: {} })),
      subscribe: vi.fn(() => unsubscribe),
    };
    const resolve = vi.fn(async () => source);
    const deferred = deferredLiveSource(resolve);

    await deferred.snapshot();
    const detach = await deferred.subscribe(vi.fn());
    detach();

    expect(resolve).toHaveBeenCalledOnce();
    expect(source.snapshot).toHaveBeenCalledOnce();
    expect(source.subscribe).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
