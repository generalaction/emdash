import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProcessPoller, type ProcessSnapshotResult } from './process-poller';

const SNAPSHOT: ProcessSnapshotResult = {
  supported: true,
  processes: [{ pid: 1, ppid: 0, depth: 0, cpuPercent: 1, rssBytes: 1024, command: 'emdash' }],
};

describe('createProcessPoller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches immediately, then at the polling interval', async () => {
    const fetchSnapshot = vi.fn(async () => SNAPSHOT);
    const onSnapshot = vi.fn();
    const poller = createProcessPoller({ fetchSnapshot, onSnapshot, intervalMs: 1_000 });

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    expect(onSnapshot).toHaveBeenCalledWith(SNAPSHOT);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchSnapshot).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchSnapshot).toHaveBeenCalledTimes(3);

    poller.stop();
  });

  it('fully stops on stop(): no pending timers, in-flight results dropped', async () => {
    let resolveFetch: ((value: ProcessSnapshotResult) => void) | null = null;
    const fetchSnapshot = vi.fn(
      () => new Promise<ProcessSnapshotResult>((resolve) => (resolveFetch = resolve))
    );
    const onSnapshot = vi.fn();
    const poller = createProcessPoller({ fetchSnapshot, onSnapshot, intervalMs: 1_000 });

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);

    poller.stop();
    resolveFetch!(SNAPSHOT);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(onSnapshot).not.toHaveBeenCalled();
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps polling through transient fetch failures', async () => {
    const fetchSnapshot = vi
      .fn<() => Promise<ProcessSnapshotResult>>()
      .mockRejectedValueOnce(new Error('rpc down'))
      .mockResolvedValue(SNAPSHOT);
    const onSnapshot = vi.fn();
    const poller = createProcessPoller({ fetchSnapshot, onSnapshot, intervalMs: 1_000 });

    await vi.advanceTimersByTimeAsync(0);
    expect(onSnapshot).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(onSnapshot).toHaveBeenCalledWith(SNAPSHOT);

    poller.stop();
  });
});
