import { abortReason, systemClock, type Clock } from './clock';
import type { TimerHandle } from './timer-handle';

export type RunWithTimeoutOptions = {
  timeoutMs: number;
  signal?: AbortSignal;
  clock?: Clock;
};

export class TimeoutError extends Error {
  constructor(readonly durationMs: number) {
    super(`Operation timed out after ${durationMs}ms`);
    this.name = 'TimeoutError';
  }
}

export function runWithTimeout<T>(
  work: (signal: AbortSignal) => T | Promise<T>,
  options: RunWithTimeoutOptions
): Promise<T> {
  if (options.signal?.aborted) return Promise.reject(abortReason(options.signal));
  if (options.timeoutMs <= 0) return Promise.reject(new TimeoutError(options.timeoutMs));

  const clock = options.clock ?? systemClock;
  const controller = new AbortController();

  return new Promise<T>((resolve, reject) => {
    let settled = false;

    const finish = (complete: () => void): void => {
      if (settled) return;
      settled = true;
      timer.dispose();
      options.signal?.removeEventListener('abort', onAbort);
      complete();
    };

    const fail = (error: unknown, abortChild: boolean): void => {
      finish(() => {
        if (abortChild && !controller.signal.aborted) controller.abort(error);
        reject(error);
      });
    };

    const onAbort = (): void => {
      fail(abortReason(options.signal as AbortSignal), true);
    };

    options.signal?.addEventListener('abort', onAbort, { once: true });
    const timer: TimerHandle = clock.schedule(
      options.timeoutMs,
      () => {
        fail(new TimeoutError(options.timeoutMs), true);
      },
      { unref: true }
    );

    try {
      Promise.resolve(work(controller.signal)).then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => fail(error, false)
      );
    } catch (error) {
      fail(error, false);
    }

    if (options.signal?.aborted) onAbort();
  });
}
