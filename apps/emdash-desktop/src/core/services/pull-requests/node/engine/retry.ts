import { isNetworkError } from './errors';

export type RetryOptions = {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  signal: AbortSignal;
};

export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  const { maxAttempts = 3, initialDelayMs = 1_000, maxDelayMs = 30_000, signal } = options;
  let attempt = 0;
  let delay = initialDelayMs;
  for (;;) {
    throwIfAborted(signal);
    try {
      return await operation();
    } catch (error) {
      attempt += 1;
      const status = (error as { status?: number }).status;
      const retryable =
        status === 429 || (status !== undefined && status >= 500) || isNetworkError(error);
      if (!retryable || attempt >= maxAttempts || signal.aborted) throw error;
      await abortableDelay(delay, signal);
      delay = Math.min(delay * 2, maxDelayMs);
    }
  }
}

export class RateLimiter {
  private tokens: number;
  private lastRefill = Date.now();

  constructor(
    private readonly capacity = 20,
    private readonly refillRate = 10
  ) {
    this.tokens = capacity;
  }

  async acquire(signal: AbortSignal): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    const waitMs = Math.ceil(((1 - this.tokens) / this.refillRate) * 1_000);
    await abortableDelay(waitMs, signal);
    this.refill();
    this.tokens = Math.max(0, this.tokens - 1);
  }

  private refill(): void {
    const now = Date.now();
    this.tokens = Math.min(
      this.capacity,
      this.tokens + ((now - this.lastRefill) / 1_000) * this.refillRate
    );
    this.lastRefill = now;
  }
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('Aborted', 'AbortError');
  }
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(finish, ms);
    const onAbort = (): void => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      reject(
        signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError')
      );
    };
    function finish(): void {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
