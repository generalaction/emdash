import { describe, expect, it, vi } from 'vitest';
import { systemClock } from './clock';

describe('systemClock', () => {
  it('cancels scheduled callbacks through timer handles', async () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const handle = systemClock.schedule(1, callback);

    expect(handle.active).toBe(true);
    handle.dispose();
    expect(handle.active).toBe(false);

    await vi.advanceTimersByTimeAsync(5);
    expect(callback).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('rejects sleep when aborted', async () => {
    const abort = new AbortController();
    const sleep = systemClock.sleep(10_000, { signal: abort.signal });

    abort.abort(new Error('stop'));

    await expect(sleep).rejects.toThrow('stop');
  });
});
