import { describe, expect, it, vi } from 'vitest';
import { ManualClock, deferred } from '../testing';
import { TimeoutError, runWithTimeout } from './timeout';

describe('runWithTimeout', () => {
  it('resolves work that completes before the deadline', async () => {
    const clock = new ManualClock();

    await expect(runWithTimeout(async () => 'ok', { timeoutMs: 10, clock })).resolves.toBe('ok');

    await clock.runAll();
  });

  it('rejects and aborts the child signal when the deadline expires', async () => {
    const clock = new ManualClock();
    const started = deferred<void>();
    let aborted = false;

    const result = runWithTimeout(
      async (signal) => {
        started.resolve();
        signal.addEventListener('abort', () => {
          aborted = true;
        });
        await new Promise<never>(() => {});
      },
      { timeoutMs: 5, clock }
    );

    await started.promise;
    await clock.advanceBy(5);

    await expect(result).rejects.toBeInstanceOf(TimeoutError);
    expect(aborted).toBe(true);
  });

  it('does not invoke work for immediate timeouts', async () => {
    const work = vi.fn();

    await expect(runWithTimeout(work, { timeoutMs: 0 })).rejects.toBeInstanceOf(TimeoutError);
    expect(work).not.toHaveBeenCalled();
  });

  it('rejects with the parent cancellation reason', async () => {
    const clock = new ManualClock();
    const abort = new AbortController();
    const reason = new Error('stop');
    const started = deferred<void>();
    let childAborted = false;

    const result = runWithTimeout(
      async (signal) => {
        started.resolve();
        signal.addEventListener('abort', () => {
          childAborted = true;
        });
        await new Promise<never>(() => {});
      },
      { timeoutMs: 10, signal: abort.signal, clock }
    );

    await started.promise;
    abort.abort(reason);

    await expect(result).rejects.toBe(reason);
    expect(childAborted).toBe(true);
  });

  it('does not invoke work for an already-aborted parent signal', async () => {
    const abort = new AbortController();
    const reason = new Error('already stopped');
    const work = vi.fn();

    abort.abort(reason);

    await expect(runWithTimeout(work, { timeoutMs: 10, signal: abort.signal })).rejects.toBe(
      reason
    );
    expect(work).not.toHaveBeenCalled();
  });

  it('cleans up timers after work settles', async () => {
    const clock = new ManualClock();
    const timeout = vi.fn();

    const result = runWithTimeout(async () => 'ok', { timeoutMs: 5, clock });

    await expect(result).resolves.toBe('ok');
    clock.schedule(5, timeout);
    await clock.advanceBy(5);

    expect(timeout).toHaveBeenCalledTimes(1);
  });

  it('observes late work rejection after a timeout', async () => {
    const clock = new ManualClock();
    const gate = deferred<string>();

    const result = runWithTimeout(async () => gate.promise, { timeoutMs: 5, clock });
    await clock.advanceBy(5);

    await expect(result).rejects.toBeInstanceOf(TimeoutError);
    gate.reject(new Error('late'));
    await Promise.resolve();
  });
});
