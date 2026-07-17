import { describe, expect, it, vi } from 'vitest';
import { withRetry } from './retry';

describe('withRetry', () => {
  it('fails fast for unknown errors without a retryable status', async () => {
    const operation = vi.fn(async () => {
      throw new Error('Invalid response');
    });

    await expect(
      withRetry(operation, {
        signal: new AbortController().signal,
        maxAttempts: 3,
        initialDelayMs: 0,
      })
    ).rejects.toThrow('Invalid response');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('retries recognized network failures', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('Connection reset'), { code: 'ECONNRESET' }))
      .mockResolvedValueOnce('ok');

    await expect(
      withRetry(operation, {
        signal: new AbortController().signal,
        maxAttempts: 2,
        initialDelayMs: 0,
      })
    ).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
