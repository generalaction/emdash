import { log } from './logger';

export type RetryOptions = {
  /** Maximum number of attempts (default: 3). */
  maxAttempts?: number;
  /** Initial delay in ms before the first retry (default: 1000). */
  initialDelayMs?: number;
  /** Maximum delay in ms between retries (default: 30_000). */
  maxDelayMs?: number;
  /** When provided, aborts retrying immediately when the signal is triggered. */
  signal?: AbortSignal;
};

/**
 * Retry `fn` with exponential backoff.
 *
 * Only retries on rate-limit (429) or server errors (5xx).
 * Client errors (4xx except 429) are re-thrown immediately.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts?: RetryOptions): Promise<T> {
  const { maxAttempts = 3, initialDelayMs = 1_000, maxDelayMs = 30_000 } = opts ?? {};

  let attempt = 0;
  let delay = initialDelayMs;

  for (;;) {
    try {
      return await fn();
    } catch (err: unknown) {
      attempt++;

      const status = (err as { status?: number })?.status;
      const isRetryable = status === undefined || status === 429 || status >= 500;

      if (!isRetryable || attempt >= maxAttempts || opts?.signal?.aborted) {
        throw err;
      }

      log.warn('withRetry: retrying after error', { attempt, status, delay });
      await new Promise<void>((resolve, reject) => {
        const id = setTimeout(resolve, delay);
        opts?.signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(id);
            reject(err);
          },
          { once: true }
        );
      });
      delay = Math.min(delay * 2, maxDelayMs);
    }
  }
}
