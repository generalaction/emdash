import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetGitStatus = vi.fn();
vi.stubGlobal('window', {
  electronAPI: {
    getGitStatus: mockGetGitStatus,
  },
});

// Reset module state between tests so cache Maps are fresh
let buildCacheKey: typeof import('../../renderer/lib/gitStatusCache').buildCacheKey;
let getCachedGitStatus: typeof import('../../renderer/lib/gitStatusCache').getCachedGitStatus;
let getCachedResult: typeof import('../../renderer/lib/gitStatusCache').getCachedResult;
let onCacheRevalidated: typeof import('../../renderer/lib/gitStatusCache').onCacheRevalidated;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  const mod = await import('../../renderer/lib/gitStatusCache');
  buildCacheKey = mod.buildCacheKey;
  getCachedGitStatus = mod.getCachedGitStatus;
  getCachedResult = mod.getCachedResult;
  onCacheRevalidated = mod.onCacheRevalidated;
});

describe('gitStatusCache', () => {
  describe('buildCacheKey', () => {
    it('uses taskPath alone when no taskId', () => {
      expect(buildCacheKey('/repo')).toBe('/repo');
    });

    it('appends taskId', () => {
      expect(buildCacheKey('/repo', 'task-1')).toBe('/repo::task-1');
    });

    it('appends ::tracked when includeUntracked is false', () => {
      expect(buildCacheKey('/repo', undefined, false)).toBe('/repo::tracked');
      expect(buildCacheKey('/repo', 'task-1', false)).toBe('/repo::task-1::tracked');
    });

    it('does not append ::tracked when includeUntracked is true or undefined', () => {
      expect(buildCacheKey('/repo', undefined, true)).toBe('/repo');
      expect(buildCacheKey('/repo', undefined, undefined)).toBe('/repo');
    });
  });

  describe('getCachedGitStatus', () => {
    it('returns workspace-unavailable for empty taskPath', async () => {
      const result = await getCachedGitStatus('');
      expect(result).toEqual({ success: false, error: 'workspace-unavailable' });
      expect(mockGetGitStatus).not.toHaveBeenCalled();
    });

    it('fetches and caches on first call', async () => {
      const changes = [
        { path: 'a.ts', status: 'modified', additions: 1, deletions: 0, isStaged: false },
      ];
      mockGetGitStatus.mockResolvedValueOnce({ success: true, changes });

      const result = await getCachedGitStatus('/repo', { force: true });
      expect(result).toEqual({ success: true, changes });
      expect(mockGetGitStatus).toHaveBeenCalledOnce();
    });

    it('returns cached result within TTL without fetching', async () => {
      const changes = [
        { path: 'a.ts', status: 'modified', additions: 1, deletions: 0, isStaged: false },
      ];
      mockGetGitStatus.mockResolvedValueOnce({ success: true, changes });

      await getCachedGitStatus('/repo', { force: true });
      mockGetGitStatus.mockClear();

      const result = await getCachedGitStatus('/repo');
      expect(result).toEqual({ success: true, changes });
      expect(mockGetGitStatus).not.toHaveBeenCalled();
    });

    it('deduplicates concurrent requests for the same key', async () => {
      let resolve!: (v: unknown) => void;
      mockGetGitStatus.mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          })
      );

      const p1 = getCachedGitStatus('/repo', { force: true });
      const p2 = getCachedGitStatus('/repo');

      const changes = [
        { path: 'a.ts', status: 'modified', additions: 1, deletions: 0, isStaged: false },
      ];
      resolve({ success: true, changes });

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toEqual(r2);
      expect(mockGetGitStatus).toHaveBeenCalledOnce();
    });

    it('separates cache by includeUntracked', async () => {
      const fullChanges = [
        { path: 'a.ts', status: 'modified', additions: 1, deletions: 0, isStaged: false },
        { path: 'new.ts', status: 'added', additions: 3, deletions: 0, isStaged: false },
      ];
      const trackedChanges = [
        { path: 'a.ts', status: 'modified', additions: 1, deletions: 0, isStaged: false },
      ];

      mockGetGitStatus.mockResolvedValueOnce({ success: true, changes: fullChanges });
      mockGetGitStatus.mockResolvedValueOnce({ success: true, changes: trackedChanges });

      await getCachedGitStatus('/repo', { force: true, includeUntracked: true });
      await getCachedGitStatus('/repo', { force: true, includeUntracked: false });

      expect(mockGetGitStatus).toHaveBeenCalledTimes(2);

      mockGetGitStatus.mockClear();
      const full = await getCachedGitStatus('/repo', { includeUntracked: true });
      const tracked = await getCachedGitStatus('/repo', { includeUntracked: false });

      expect(full.changes).toHaveLength(2);
      expect(tracked.changes).toHaveLength(1);
      expect(mockGetGitStatus).not.toHaveBeenCalled();
    });
  });

  describe('stale-while-revalidate', () => {
    it('returns stale data immediately and caches fresh data after background refresh', async () => {
      const staleChanges = [
        { path: 'old.ts', status: 'modified', additions: 1, deletions: 0, isStaged: false },
      ];
      const freshChanges = [
        { path: 'new.ts', status: 'added', additions: 5, deletions: 0, isStaged: false },
      ];

      mockGetGitStatus.mockResolvedValueOnce({ success: true, changes: staleChanges });
      await getCachedGitStatus('/repo', { force: true });

      vi.useFakeTimers();
      vi.advanceTimersByTime(31000);
      mockGetGitStatus.mockClear();
      mockGetGitStatus.mockResolvedValueOnce({ success: true, changes: freshChanges });

      // Should return stale data immediately
      const staleResult = await getCachedGitStatus('/repo');
      expect(staleResult).toEqual({ success: true, changes: staleChanges });
      expect(mockGetGitStatus).toHaveBeenCalledOnce();

      // Let background refresh complete
      await vi.runAllTimersAsync();

      // Fresh data should now be cached
      mockGetGitStatus.mockClear();
      const freshResult = await getCachedGitStatus('/repo');
      expect(freshResult).toEqual({ success: true, changes: freshChanges });
      expect(mockGetGitStatus).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('preserves known-good cache entry on background refresh failure', async () => {
      const goodChanges = [
        { path: 'a.ts', status: 'modified', additions: 1, deletions: 0, isStaged: false },
      ];

      mockGetGitStatus.mockResolvedValueOnce({ success: true, changes: goodChanges });
      await getCachedGitStatus('/repo', { force: true });

      vi.useFakeTimers();
      vi.advanceTimersByTime(31000);
      mockGetGitStatus.mockClear();
      mockGetGitStatus.mockRejectedValueOnce(new Error('network error'));

      // SWR returns stale data
      await getCachedGitStatus('/repo');

      // Let failed background refresh complete
      await vi.runAllTimersAsync();

      // Cache should still contain the good data, not the error
      const cached = getCachedResult('/repo');
      expect(cached).toBeDefined();
      expect(cached!.result.success).toBe(true);
      expect(cached!.result.changes).toEqual(goodChanges);

      vi.useRealTimers();
    });
  });

  describe('onCacheRevalidated', () => {
    it('notifies listeners with fresh data on background revalidation', async () => {
      const staleChanges = [
        { path: 'old.ts', status: 'modified', additions: 1, deletions: 0, isStaged: false },
      ];
      const freshChanges = [
        { path: 'new.ts', status: 'added', additions: 5, deletions: 0, isStaged: false },
      ];

      mockGetGitStatus.mockResolvedValueOnce({ success: true, changes: staleChanges });
      await getCachedGitStatus('/repo', { force: true });

      const notifications: Array<{ key: string; changes: number }> = [];
      const unsub = onCacheRevalidated((key, result) => {
        notifications.push({ key, changes: result.changes?.length ?? 0 });
      });

      vi.useFakeTimers();
      vi.advanceTimersByTime(31000);
      mockGetGitStatus.mockResolvedValueOnce({ success: true, changes: freshChanges });
      await getCachedGitStatus('/repo');
      await vi.runAllTimersAsync();

      expect(notifications).toHaveLength(1);
      expect(notifications[0]).toEqual({ key: '/repo', changes: 1 });

      unsub();
      vi.useRealTimers();
    });

    it('notifies listeners on failed background revalidation', async () => {
      const goodChanges = [
        { path: 'a.ts', status: 'modified', additions: 1, deletions: 0, isStaged: false },
      ];

      mockGetGitStatus.mockResolvedValueOnce({ success: true, changes: goodChanges });
      await getCachedGitStatus('/repo', { force: true });

      const notifications: Array<{ key: string; success: boolean }> = [];
      const unsub = onCacheRevalidated((key, result) => {
        notifications.push({ key, success: result.success });
      });

      vi.useFakeTimers();
      vi.advanceTimersByTime(31000);
      mockGetGitStatus.mockRejectedValueOnce(new Error('network error'));
      await getCachedGitStatus('/repo');
      await vi.runAllTimersAsync();

      expect(notifications).toHaveLength(1);
      expect(notifications[0]).toEqual({ key: '/repo', success: false });

      unsub();
      vi.useRealTimers();
    });

    it('cleans up listener on unsubscribe', async () => {
      const listener = vi.fn();
      const unsub = onCacheRevalidated(listener);

      mockGetGitStatus.mockResolvedValueOnce({ success: true, changes: [] });
      await getCachedGitStatus('/repo', { force: true });

      unsub();

      vi.useFakeTimers();
      vi.advanceTimersByTime(31000);
      mockGetGitStatus.mockResolvedValueOnce({ success: true, changes: [] });
      await getCachedGitStatus('/repo');
      await vi.runAllTimersAsync();

      expect(listener).not.toHaveBeenCalled();
      vi.useRealTimers();
    });
  });
});
