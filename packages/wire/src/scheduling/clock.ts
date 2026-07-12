import type { TimerHandle } from './timer-handle';

export const MAX_TIMER_DELAY_MS = 2_147_483_647;

export type ScheduleOptions = {
  unref?: boolean;
};

export type SleepOptions = ScheduleOptions & {
  signal?: AbortSignal;
};

export interface Clock {
  now(): number;
  schedule(delayMs: number, callback: () => void, options?: ScheduleOptions): TimerHandle;
  sleep(delayMs: number, options?: SleepOptions): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  schedule(delayMs, callback, options = {}) {
    let active = true;
    const timer = setTimeout(() => {
      if (!active) return;
      active = false;
      callback();
    }, normalizeDelay(delayMs));
    if (options.unref) {
      (timer as unknown as { unref?: () => void }).unref?.();
    }
    return {
      get active() {
        return active;
      },
      dispose() {
        if (!active) return;
        active = false;
        clearTimeout(timer);
      },
    };
  },
  sleep(delayMs, options = {}) {
    return sleepWithClock(systemClock, delayMs, options);
  },
};

export function normalizeDelay(delayMs: number): number {
  if (!Number.isFinite(delayMs)) return MAX_TIMER_DELAY_MS;
  return Math.min(MAX_TIMER_DELAY_MS, Math.max(0, Math.floor(delayMs)));
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortReason(signal);
}

export function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Aborted', 'AbortError');
}

export function sleepWithClock(
  clock: Pick<Clock, 'schedule'>,
  delayMs: number,
  options: SleepOptions = {}
): Promise<void> {
  throwIfAborted(options.signal);
  if (delayMs <= 0) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = clock.schedule(delayMs, () => finish(resolve), options);

    const onAbort = (): void => {
      finish(() => reject(abortReason(options.signal as AbortSignal)));
    };

    function finish(complete: () => void): void {
      if (settled) return;
      settled = true;
      timer.dispose();
      options.signal?.removeEventListener('abort', onAbort);
      complete();
    }

    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
  });
}
