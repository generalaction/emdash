import { ok, type Result } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import type { PullError, PushError } from './api/errors';
import type { IGitCheckout } from './checkout/types';
import { createGitSessionJobs, type GitResourceAccessor } from './jobs';
import type { IGitRuntime } from './types';

function mockResources(checkout: Partial<IGitCheckout>): GitResourceAccessor {
  return {
    repository: vi.fn(async () => ({}) as never),
    checkout: vi.fn(async () => checkout as IGitCheckout),
  };
}

describe('createGitSessionJobs', () => {
  it('starts a job and reports the terminal result', async () => {
    const checkout = {
      push: vi.fn(async () => ok({ output: 'pushed' })),
    };
    const resources = mockResources(checkout);
    const jobs = createGitSessionJobs({} as IGitRuntime, resources);

    const { jobId } = jobs.push.start({ checkoutPath: '/repo' });

    await vi.waitFor(() => {
      expect(jobs.push.job(jobId)?.snapshot().data).toEqual({
        status: 'succeeded',
        result: { output: 'pushed' },
      });
    });
  });

  it('cancels running jobs', async () => {
    const checkout = {
      pull: vi.fn(
        (_context?: unknown): Promise<Result<{ output: string }, PullError>> =>
          new Promise((_resolve, reject) => {
            const signal = (_context as { signal?: AbortSignal } | undefined)?.signal;
            signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
            if (signal?.aborted) reject(new Error('aborted'));
            void _resolve;
          })
      ),
    };
    const resources = mockResources(checkout);
    const jobs = createGitSessionJobs({} as IGitRuntime, resources);

    const { jobId } = jobs.pull.start({ checkoutPath: '/repo' });
    await vi.waitFor(() => expect(checkout.pull).toHaveBeenCalled());

    jobs.pull.cancel(jobId);

    await vi.waitFor(() => {
      expect(jobs.pull.job(jobId)?.snapshot().data).toEqual({ status: 'cancelled' });
    });
  });

  it('classifies domain errors as typed job failures', async () => {
    const domainError = { type: 'rejected' as const, message: 'non-fast-forward' };
    const checkout = {
      push: vi.fn(async (): Promise<Result<{ output: string }, PushError>> => ({
        success: false,
        error: domainError,
      })),
    };
    const resources = mockResources(checkout);
    const jobs = createGitSessionJobs({} as IGitRuntime, resources);

    const { jobId } = jobs.push.start({ checkoutPath: '/repo' });

    await vi.waitFor(() => {
      const state = jobs.push.job(jobId)?.snapshot().data;
      expect(state).toEqual({ status: 'failed', error: domainError });
    });
  });
});
