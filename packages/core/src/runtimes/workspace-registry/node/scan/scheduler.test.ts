import path from 'node:path';
import type { IWatchService, WatchEvent, WatchOptions } from '@services/fs-watch/api';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ACTIVE_SCAN_DEBOUNCE_MS,
  DEFAULT_SCAN_DEBOUNCE_MS,
  WorkspaceScanScheduler,
  type ScanRequest,
  type ScanTarget,
} from './scheduler';

// Unit tests at the scheduler's public seam: fs events (via a fake watch service) and
// scan targets go in; coalesced scan requests come out. The scheduler never writes the
// registry — its whole contract is which requests it emits and when.

class FakeWatchService implements IWatchService {
  readonly roots = new Map<string, (events: WatchEvent[]) => void>();
  watch(root: string, onEvents: (events: WatchEvent[]) => void, _options?: WatchOptions) {
    this.roots.set(root, onEvents);
    return {
      ready: () => Promise.resolve(),
      release: () => {
        this.roots.delete(root);
        return Promise.resolve();
      },
    };
  }
  dispose(): Promise<void> {
    return Promise.resolve();
  }
  emit(root: string, events: WatchEvent[]): void {
    this.roots.get(root)?.(events);
  }
}

function repoTarget(id: string, repoPath: string): ScanTarget {
  return {
    id,
    kind: 'repository',
    path: repoPath,
    parentId: null,
    observedStatus: 'present',
    lastObservedAt: 0,
  };
}

function worktreeTarget(id: string, worktreePath: string, parentId: string): ScanTarget {
  return {
    id,
    kind: 'worktree',
    path: worktreePath,
    parentId,
    observedStatus: 'present',
    lastObservedAt: 0,
  };
}

async function eventually(assertion: () => void, timeoutMs = 3_000): Promise<void> {
  const started = Date.now();
  for (;;) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() - started > timeoutMs) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

type Harness = {
  watcher: FakeWatchService;
  requests: ScanRequest[];
  scheduler: WorkspaceScanScheduler;
};

function createHarness(
  targets: ScanTarget[],
  options: {
    debounceMs?: number;
    activeDebounceMs?: number;
    pollIntervalMs?: number;
    active?: Set<string>;
    block?: () => Promise<void>;
  } = {}
): Harness {
  const watcher = new FakeWatchService();
  const requests: ScanRequest[] = [];
  const scheduler = new WorkspaceScanScheduler({
    watcher,
    execute: async (request) => {
      requests.push(request);
      await options.block?.();
    },
    listTargets: () => targets,
    isActive: (id) => options.active?.has(id) ?? false,
    debounceMs: options.debounceMs ?? 20,
    activeDebounceMs: options.activeDebounceMs ?? 5,
    pollIntervalMs: options.pollIntervalMs ?? 60 * 60_000,
  });
  scheduler.start();
  return { watcher, requests, scheduler };
}

describe('WorkspaceScanScheduler', () => {
  it('classifies ref-only gitdir events onto the cheap path, index onto the full path', async () => {
    const repo = repoTarget('repo-1', '/repos/main');
    const wt = worktreeTarget('wt-1', '/worktrees/wt', 'repo-1');
    const { watcher, requests, scheduler } = createHarness([repo, wt]);
    try {
      const gitDir = path.join('/repos/main', '.git');
      watcher.emit(gitDir, [{ kind: 'update', path: path.join(gitDir, 'refs/heads/main') }]);
      await eventually(() => {
        // Refs move ripples divergence to the repo and every worktree — cheap scans only.
        expect(requests).toEqual([
          { kind: 'workspace', id: 'repo-1', mode: 'refs' },
          { kind: 'workspace', id: 'wt-1', mode: 'refs' },
        ]);
      });

      requests.length = 0;
      watcher.emit(gitDir, [{ kind: 'update', path: path.join(gitDir, 'index') }]);
      await eventually(() => {
        expect(requests).toEqual([{ kind: 'workspace', id: 'repo-1', mode: 'full' }]);
      });
    } finally {
      await scheduler.dispose();
    }
  });

  it('ignores FETCH_HEAD and ORIG_HEAD writes (no-change fetch churn triggers nothing)', async () => {
    const repo = repoTarget('repo-1', '/repos/main');
    const wt = worktreeTarget('wt-1', '/worktrees/wt', 'repo-1');
    const { watcher, requests, scheduler } = createHarness([repo, wt], { debounceMs: 5 });
    try {
      const gitDir = path.join('/repos/main', '.git');
      watcher.emit(gitDir, [
        { kind: 'update', path: path.join(gitDir, 'FETCH_HEAD') },
        { kind: 'update', path: path.join(gitDir, 'ORIG_HEAD') },
      ]);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(requests).toHaveLength(0);

      // A fetch that actually moved refs still fans out via packed-refs / refs/remotes.
      watcher.emit(gitDir, [
        { kind: 'update', path: path.join(gitDir, 'FETCH_HEAD') },
        { kind: 'update', path: path.join(gitDir, 'packed-refs') },
      ]);
      await eventually(() => {
        expect(requests).toEqual([
          { kind: 'workspace', id: 'repo-1', mode: 'refs' },
          { kind: 'workspace', id: 'wt-1', mode: 'refs' },
        ]);
      });
    } finally {
      await scheduler.dispose();
    }
  });

  it('defaults the active debounce to 1 s and the idle debounce to 2 s', () => {
    expect(DEFAULT_SCAN_DEBOUNCE_MS).toBe(2_000);
    expect(DEFAULT_ACTIVE_SCAN_DEBOUNCE_MS).toBe(1_000);
  });

  it('worktree admin changes trigger repository reconciliation (adoption path)', async () => {
    const repo = repoTarget('repo-1', '/repos/main');
    const { watcher, requests, scheduler } = createHarness([repo]);
    try {
      const gitDir = path.join('/repos/main', '.git');
      watcher.emit(gitDir, [
        { kind: 'create', path: path.join(gitDir, 'worktrees/new-wt/gitdir') },
      ]);
      await eventually(() => {
        expect(requests).toEqual([{ kind: 'repository', id: 'repo-1' }]);
      });
    } finally {
      await scheduler.dispose();
    }
  });

  it('coalesces rapid triggers into one scan, full subsuming refs', async () => {
    const repo = repoTarget('repo-1', '/repos/main');
    const { watcher, requests, scheduler } = createHarness([repo], { debounceMs: 30 });
    try {
      const gitDir = path.join('/repos/main', '.git');
      for (let i = 0; i < 10; i += 1) {
        watcher.emit(gitDir, [{ kind: 'update', path: path.join(gitDir, 'refs/heads/main') }]);
        watcher.emit('/repos/main', [{ kind: 'update', path: '/repos/main/file.txt' }]);
      }
      await eventually(() => {
        expect(requests).toEqual([{ kind: 'workspace', id: 'repo-1', mode: 'full' }]);
      });
      // Nothing further arrives once the burst has been absorbed.
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(requests).toHaveLength(1);
    } finally {
      await scheduler.dispose();
    }
  });

  it('triggers arriving during an in-flight scan re-run after it, once', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const repo = repoTarget('repo-1', '/repos/main');
    const { watcher, requests, scheduler } = createHarness([repo], {
      debounceMs: 5,
      block: () => gate,
    });
    try {
      watcher.emit('/repos/main', [{ kind: 'update', path: '/repos/main/a.txt' }]);
      await eventually(() => expect(requests).toHaveLength(1));
      // Three more bursts while the first scan is still running.
      watcher.emit('/repos/main', [{ kind: 'update', path: '/repos/main/b.txt' }]);
      watcher.emit('/repos/main', [{ kind: 'update', path: '/repos/main/c.txt' }]);
      watcher.emit('/repos/main', [{ kind: 'update', path: '/repos/main/d.txt' }]);
      release();
      await eventually(() => expect(requests).toHaveLength(2));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(requests).toHaveLength(2);
    } finally {
      await scheduler.dispose();
    }
  });

  it('polling floor rescans stale records even with no fs events', async () => {
    const repo = repoTarget('repo-1', '/repos/main');
    const dir: ScanTarget = {
      id: 'dir-1',
      kind: 'directory',
      path: '/plain',
      parentId: null,
      observedStatus: 'missing',
      lastObservedAt: 0,
    };
    const { requests, scheduler } = createHarness([repo, dir], {
      debounceMs: 1,
      pollIntervalMs: 25,
    });
    try {
      await eventually(() => {
        expect(requests).toContainEqual({ kind: 'repository', id: 'repo-1' });
        // Missing records poll too — that is how a returned path is noticed.
        expect(requests).toContainEqual({ kind: 'workspace', id: 'dir-1', mode: 'full' });
      });
    } finally {
      await scheduler.dispose();
    }
  });

  it('does not watch missing paths, and drops watches when targets vanish', async () => {
    const targets: ScanTarget[] = [repoTarget('repo-1', '/repos/main')];
    const { watcher, scheduler } = createHarness(targets);
    try {
      expect([...watcher.roots.keys()].sort()).toEqual([
        '/repos/main',
        path.join('/repos/main', '.git'),
      ]);
      targets.length = 0;
      scheduler.syncWatches();
      expect(watcher.roots.size).toBe(0);
    } finally {
      await scheduler.dispose();
    }
  });
});
