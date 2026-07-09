export type ComputedStateApply<T> = (fresh: T) => void;

export type ComputedStateOptions<T> = {
  compute: () => Promise<T>;
  apply: ComputedStateApply<T>;
  debounceMs?: number;
  intervalMs?: number;
  onError?: (error: unknown) => void;
};

export interface ComputedState<T> {
  invalidate(): void;
  refresh(): Promise<void>;
  refreshInto(apply: ComputedStateApply<T>): Promise<void>;
  dispose(): void;
}

type QueuedJob<T> = {
  apply: ComputedStateApply<T>;
  reportOnly: boolean;
};

export function createComputedState<T>(options: ComputedStateOptions<T>): ComputedState<T> {
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let intervalTimer: ReturnType<typeof setInterval> | undefined;
  let tail: Promise<void> = Promise.resolve();
  let disposed = false;
  let invalidationQueued = false;

  const computed: ComputedState<T> = {
    invalidate(): void {
      if (disposed) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = undefined;
        queueInvalidation();
      }, options.debounceMs ?? 0);
      debounceTimer.unref?.();
    },
    refresh(): Promise<void> {
      return refreshWith(options.apply);
    },
    refreshInto(apply): Promise<void> {
      return refreshWith(apply);
    },
    dispose(): void {
      disposed = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      if (intervalTimer) clearInterval(intervalTimer);
      debounceTimer = undefined;
      intervalTimer = undefined;
    },
  };

  if (options.intervalMs !== undefined) {
    intervalTimer = setInterval(() => computed.invalidate(), options.intervalMs);
    intervalTimer.unref?.();
  }

  return computed;

  function refreshWith(apply: ComputedStateApply<T>): Promise<void> {
    if (disposed) return Promise.resolve();
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = undefined;
    }
    return enqueue({ apply, reportOnly: false });
  }

  function queueInvalidation(): void {
    if (disposed || invalidationQueued) return;
    invalidationQueued = true;
    void enqueue({ apply: options.apply, reportOnly: true }).finally(() => {
      invalidationQueued = false;
    });
  }

  function enqueue(job: QueuedJob<T>): Promise<void> {
    const run = async (): Promise<void> => {
      if (disposed) return;
      try {
        const fresh = await options.compute();
        if (!disposed) job.apply(fresh);
      } catch (error) {
        options.onError?.(error);
        if (!job.reportOnly) throw error;
      }
    };
    const next = tail.then(run, run);
    tail = next.catch(() => {});
    return next;
  }
}
