import { runWithTimeout, TimeoutError, type Clock } from '@emdash/shared/scheduling';
import { WireError } from './protocol';

export type WithTimeoutOptions = {
  timeoutMs: number;
  clock?: Clock;
};

type SignalContext = {
  signal?: AbortSignal;
};

type SignalHandler<I, O, C extends SignalContext> = (input: I, context: C) => Promise<O>;

export function withTimeout(options: WithTimeoutOptions) {
  return function <I, O, C extends SignalContext>(
    next: SignalHandler<I, O, C>
  ): SignalHandler<I, O, C> {
    return async (input, context) => {
      try {
        return await runWithTimeout((signal) => next(input, { ...context, signal } as C), {
          timeoutMs: options.timeoutMs,
          signal: context.signal,
          clock: options.clock,
        });
      } catch (error) {
        if (error instanceof TimeoutError) {
          throw new WireError('TIMEOUT', error.message, { cause: error });
        }
        throw error;
      }
    };
  };
}
