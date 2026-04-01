import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { shouldRefreshFileChanges } from '../../renderer/hooks/useFileChanges';

// Mock external dependencies
const mockGetGitStatus = vi.fn();
const mockWatchGitStatus = vi.fn().mockResolvedValue({ success: false });
const mockUnwatchGitStatus = vi.fn().mockResolvedValue({});
const mockOnGitStatusChanged = vi.fn().mockReturnValue(() => {});

Object.defineProperty(window, 'electronAPI', {
  value: {
    getGitStatus: mockGetGitStatus,
    watchGitStatus: mockWatchGitStatus,
    unwatchGitStatus: mockUnwatchGitStatus,
    onGitStatusChanged: mockOnGitStatusChanged,
  },
  writable: true,
});

vi.mock('@/lib/fileChangeEvents', () => ({
  subscribeToFileChanges: vi.fn().mockReturnValue(() => {}),
}));

const { useFileChanges } = await import('../../renderer/hooks/useFileChanges');

function makeChanges(paths: string[]) {
  return paths.map((p) => ({
    path: p,
    status: 'modified',
    additions: 1,
    deletions: 0,
    isStaged: false,
  }));
}

describe('shouldRefreshFileChanges', () => {
  it('refreshes when the task is active and the document is visible', () => {
    expect(shouldRefreshFileChanges('/tmp/task', true, true)).toBe(true);
  });

  it('refreshes when the task is active and the document is visible (focus is no longer required)', () => {
    expect(shouldRefreshFileChanges('/tmp/task', true, true)).toBe(true);
  });

  it('does not refresh when the task path is missing', () => {
    expect(shouldRefreshFileChanges(undefined, true, true)).toBe(false);
  });

  it('does not refresh when the task is inactive', () => {
    expect(shouldRefreshFileChanges('/tmp/task', false, true)).toBe(false);
  });

  it('does not refresh when the document is hidden', () => {
    expect(shouldRefreshFileChanges('/tmp/task', true, false)).toBe(false);
  });
});

describe('useFileChanges taskId transitions', () => {
  let useFileChangesLocal: typeof useFileChanges;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import('../../renderer/hooks/useFileChanges');
    useFileChangesLocal = mod.useFileChanges;
  });

  it('fetches with the new taskId when taskId changes on the same taskPath', async () => {
    const changesA = makeChanges(['a.ts']);
    const changesB = makeChanges(['b.ts']);

    mockGetGitStatus.mockImplementation((arg: { taskId?: string }) => {
      if (arg.taskId === 'task-A') return Promise.resolve({ success: true, changes: changesA });
      if (arg.taskId === 'task-B') return Promise.resolve({ success: true, changes: changesB });
      return Promise.resolve({ success: true, changes: [] });
    });

    const { result, rerender } = renderHook(
      ({ taskPath, taskId }: { taskPath: string; taskId: string }) =>
        useFileChangesLocal(taskPath, { taskId }),
      { initialProps: { taskPath: '/repo', taskId: 'task-A' } }
    );

    await waitFor(() => {
      expect(result.current.fileChanges).toHaveLength(1);
      expect(result.current.fileChanges[0].path).toBe('a.ts');
    });

    rerender({ taskPath: '/repo', taskId: 'task-B' });

    await waitFor(() => {
      expect(result.current.fileChanges).toHaveLength(1);
      expect(result.current.fileChanges[0].path).toBe('b.ts');
    });

    const calls = mockGetGitStatus.mock.calls;
    const lastCall = calls[calls.length - 1][0];
    expect(lastCall.taskId).toBe('task-B');
  });

  it('discards stale results from old taskId after switching', async () => {
    const changesA = makeChanges(['a.ts']);
    const changesB = makeChanges(['fresh-b.ts']);

    // Load task A successfully first
    mockGetGitStatus.mockResolvedValueOnce({ success: true, changes: changesA });

    const { result, rerender } = renderHook(
      ({ taskPath, taskId }: { taskPath: string; taskId: string }) =>
        useFileChangesLocal(taskPath, { taskId }),
      { initialProps: { taskPath: '/repo', taskId: 'task-A' } }
    );

    await waitFor(() => {
      expect(result.current.fileChanges[0]?.path).toBe('a.ts');
    });

    // Now make A's next fetch hang (simulating a slow refresh)
    let resolveStaleA!: (v: unknown) => void;
    mockGetGitStatus.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStaleA = resolve;
        })
    );

    // Force a refresh for A (e.g., watcher event) to start an in-flight request
    await act(async () => {
      result.current.refreshChanges();
    });

    // Switch to task B while A's refresh is in-flight
    mockGetGitStatus.mockResolvedValue({ success: true, changes: changesB });
    rerender({ taskPath: '/repo', taskId: 'task-B' });

    // Resolve A's stale response
    await act(async () => {
      resolveStaleA({ success: true, changes: makeChanges(['stale-a.ts']) });
    });

    // Wait for B to load
    await waitFor(() => {
      expect(result.current.fileChanges).toHaveLength(1);
      expect(result.current.fileChanges[0].path).toBe('fresh-b.ts');
    });
  });
});
