import type { CallMeta } from '../api/bind';
import { stableStringify } from '../live/mutations';

export type DeduplicateRequestsOptions<I> = {
  key?: (input: I) => string;
};

export function deduplicateRequests<I, O>(
  fn: (input: I, meta?: CallMeta) => Promise<O> | O,
  options: DeduplicateRequestsOptions<I> = {}
): (input: I, meta?: CallMeta) => Promise<O> {
  const keyOf = options.key ?? stableStringify;
  const inFlight = new Map<string, Promise<O>>();

  return (input, meta) => {
    const key = keyOf(input);
    const existing = inFlight.get(key);
    if (existing) return existing;

    const promise = new Promise<O>((resolve) => {
      resolve(fn(input, meta));
    }).finally(() => {
      if (inFlight.get(key) === promise) inFlight.delete(key);
    });
    inFlight.set(key, promise);
    return promise;
  };
}
