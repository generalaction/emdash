import { retry, type RetryOptions } from '../scheduling';

type SignalContext = {
  signal?: AbortSignal;
};

type SignalHandler<I, O, C extends SignalContext> = (input: I, context: C) => Promise<O>;

export type WithRetryOptions = RetryOptions;

export function withRetry(options: WithRetryOptions) {
  return function <I, O, C extends SignalContext>(
    next: SignalHandler<I, O, C>
  ): SignalHandler<I, O, C> {
    return (input, context) =>
      retry(async ({ signal }) => await next(input, { ...context, signal } as C), {
        clock: options.clock,
        schedule: options.schedule,
        signal: context.signal,
        shouldRetry: options.shouldRetry,
        onRetry: options.onRetry,
      });
  };
}
