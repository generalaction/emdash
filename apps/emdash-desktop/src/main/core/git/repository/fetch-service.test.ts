import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitRepositoryFetchService, nextBackgroundFetchDelay } from './fetch-service';

const runtime = vi.hoisted(() => ({ runGitJob: vi.fn() }));

vi.mock('@main/core/git/runtime-client', async (importOriginal) => ({
  ...(await importOriginal()),
  runGitJob: runtime.runGitJob,
}));

const INTERVAL_MS = 2 * 60 * 1000;

function createService() {
  const fetch = {};
  const snapshot = vi.fn().mockResolvedValue({
    data: { remotes: [{ name: 'origin', url: 'git@github.com:owner/repo.git' }] },
  });
  const getRemote = vi.fn().mockResolvedValue('origin');
  const git = {
    repository: {
      fetch,
      model: { state: vi.fn(() => ({ snapshot })) },
    },
  };
  const repository = { repository: { root: { kind: 'posix' }, segments: ['repo'] } };
  const service = new GitRepositoryFetchService(git as never, repository as never, getRemote);
  return { service, fetch };
}

/** Each background fetch resolves after `durationMs` of (fake) wall time. */
function fetchesTaking(durationMs: number) {
  runtime.runGitJob.mockImplementation(
    () =>
      new Promise((resolve) =>
        setTimeout(() => resolve({ success: true, data: undefined }), durationMs)
      )
  );
}

afterEach(() => {
  vi.useRealTimers();
  runtime.runGitJob.mockReset();
});

describe('GitRepositoryFetchService', () => {
  it('attempts background fetches for SSH remotes using system git credentials', async () => {
    runtime.runGitJob.mockResolvedValue({ success: true, data: undefined });
    const { service, fetch } = createService();

    service.start();

    await vi.waitFor(() =>
      expect(runtime.runGitJob).toHaveBeenCalledWith(
        expect.anything(),
        fetch,
        expect.objectContaining({ remote: 'origin' })
      )
    );
    service.stop();
  });

  it('fetches again one interval after a fast fetch completes', async () => {
    vi.useFakeTimers();
    fetchesTaking(1_000);
    const { service } = createService();

    service.start();
    await vi.advanceTimersByTimeAsync(1_000 + INTERVAL_MS - 1);
    expect(runtime.runGitJob).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(runtime.runGitJob).toHaveBeenCalledTimes(2);
    service.stop();
  });

  it('measures the pause from the end of a slow fetch and stretches it', async () => {
    vi.useFakeTimers();
    const slowFetchMs = 110_000;
    fetchesTaking(slowFetchMs);
    const { service } = createService();

    service.start();
    const nextFetchAt = slowFetchMs + nextBackgroundFetchDelay(slowFetchMs);
    // A fixed 2-minute cadence would start the next fetch seconds after this one ends.
    await vi.advanceTimersByTimeAsync(nextFetchAt - 1);
    expect(runtime.runGitJob).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(runtime.runGitJob).toHaveBeenCalledTimes(2);
    service.stop();
  });

  it('does not reschedule after being stopped during an in-flight fetch', async () => {
    vi.useFakeTimers();
    fetchesTaking(10_000);
    const { service } = createService();

    service.start();
    await vi.advanceTimersByTimeAsync(5_000);
    service.stop();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(runtime.runGitJob).toHaveBeenCalledTimes(1);
  });

  it('runs a single loop when restarted during an in-flight fetch', async () => {
    vi.useFakeTimers();
    fetchesTaking(10_000);
    const { service } = createService();

    service.start();
    await vi.advanceTimersByTimeAsync(5_000);
    service.stop();
    service.start();
    // The restarted loop joins the in-flight fetch; only one follow-up is scheduled.
    await vi.advanceTimersByTimeAsync(5_000 + INTERVAL_MS + 1);
    expect(runtime.runGitJob).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000 + INTERVAL_MS);
    expect(runtime.runGitJob).toHaveBeenCalledTimes(3);
    service.stop();
  });
});

describe('nextBackgroundFetchDelay', () => {
  it('keeps the default interval for fast fetches', () => {
    expect(nextBackgroundFetchDelay(0)).toBe(INTERVAL_MS);
    expect(nextBackgroundFetchDelay(5_000)).toBe(INTERVAL_MS);
  });

  it('pauses ten times as long as a slow fetch took, up to 30 minutes', () => {
    expect(nextBackgroundFetchDelay(30_000)).toBe(5 * 60 * 1000);
    expect(nextBackgroundFetchDelay(10 * 60 * 1000)).toBe(30 * 60 * 1000);
  });
});
