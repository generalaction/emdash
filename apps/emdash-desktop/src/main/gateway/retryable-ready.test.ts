import { describe, expect, it } from 'vitest';
import { createRetryableReady } from './retryable-ready';

describe('createRetryableReady', () => {
  it('retries initialization after a failed attempt', async () => {
    let attempts = 0;
    const ready = createRetryableReady(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('factory failed');
    });

    const failedAttempt = ready();
    expect(ready()).toBe(failedAttempt);
    await expect(failedAttempt).rejects.toThrow('factory failed');

    const successfulAttempt = ready();
    await successfulAttempt;

    expect(attempts).toBe(2);
    expect(ready()).toBe(successfulAttempt);
  });
});
