import type { CallMeta } from '../api/controller';
import { stableStringify } from '../live/mutations';
import { abortReason } from '../scheduling';

export type DeduplicateRequestsOptions<I> = {
  key?: (input: I) => string;
  cancelWhenUnused?: boolean;
};

type SignalContext = {
  signal?: AbortSignal;
};

type SignalHandler<I, O, C extends SignalContext> = (input: I, context: C) => Promise<O>;

type Entry<O> = {
  controller: AbortController;
  promise: Promise<O>;
  settled: boolean;
  waiters: number;
};

export function deduplicateRequests<I, O>(
  fn: (input: I, meta?: CallMeta) => Promise<O> | O,
  options: DeduplicateRequestsOptions<I> = {}
): (input: I, meta?: CallMeta) => Promise<O> {
  const middleware = deduplicate<I>(options);
  const handler = middleware(async (input: I, meta: CallMeta) => await fn(input, meta));
  return (input, meta) => handler(input, meta ?? {});
}

export function deduplicate(): <I, O, C extends SignalContext>(
  next: SignalHandler<I, O, C>
) => SignalHandler<I, O, C>;
export function deduplicate<I>(
  options: DeduplicateRequestsOptions<I>
): <O, C extends SignalContext>(next: SignalHandler<I, O, C>) => SignalHandler<I, O, C>;
export function deduplicate<I>(options: DeduplicateRequestsOptions<I> = {}) {
  return function <O, C extends SignalContext>(
    next: SignalHandler<I, O, C>
  ): SignalHandler<I, O, C> {
    const keyOf = options.key ?? stableStringify;
    const inFlight = new Map<string, Entry<O>>();

    return (input, context) => {
      const key = keyOf(input);
      let entry = inFlight.get(key);
      if (!entry) {
        entry = createEntry(key, input, context);
        inFlight.set(key, entry);
      }
      return waitForEntry(entry, context.signal);
    };

    function createEntry(key: string, input: I, context: C): Entry<O> {
      const controller = new AbortController();
      const entry = {
        controller,
        settled: false,
        waiters: 0,
      } as Entry<O>;
      let promise: Promise<O>;
      try {
        promise = next(input, { ...context, signal: controller.signal } as C);
      } catch (error) {
        promise = Promise.reject(error);
      }
      promise = promise.finally(() => {
        entry.settled = true;
        if (inFlight.get(key)?.promise === promise) inFlight.delete(key);
      });
      promise.catch(() => {});
      entry.promise = promise;
      return entry;
    }

    function waitForEntry(entry: Entry<O>, signal: AbortSignal | undefined): Promise<O> {
      if (signal?.aborted) return Promise.reject(abortReason(signal));

      entry.waiters += 1;
      return new Promise<O>((resolve, reject) => {
        let settled = false;
        const finish = (complete: () => void): void => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener('abort', onAbort);
          entry.waiters -= 1;
          if (
            options.cancelWhenUnused &&
            entry.waiters === 0 &&
            !entry.settled &&
            !entry.controller.signal.aborted
          ) {
            entry.controller.abort(new Error('Deduplicated request has no waiters'));
          }
          complete();
        };
        const onAbort = (): void => finish(() => reject(abortReason(signal as AbortSignal)));

        signal?.addEventListener('abort', onAbort, { once: true });
        entry.promise.then(
          (value) => finish(() => resolve(value)),
          (error: unknown) => finish(() => reject(error))
        );
        if (signal?.aborted) onAbort();
      });
    }
  };
}
