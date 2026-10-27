import path from 'node:path';
import { err, ok, type Result } from '@emdash/shared';
import { deferred, type Deferred } from '@emdash/shared/testing';
import { describe, expect, it, vi } from 'vitest';
import type { IWatchService, WatchEvent, WatchOptions } from '#services/fs-watch/api';
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

type FakeWatchAttempt = {
  root: string;
  ignore: string[] | undefined;
  onEvents: (events: WatchEvent[]) => void;
  onError: ((error: unknown) => void) | undefined;
  ready: Deferred<Result<void, unknown>>;
  released: boolean;
};

class FakeWatchService implements IWatchService {
  readonly roots = new Map<string, FakeWatchAttempt>();
  readonly attempts: FakeWatchAttempt[] = [];

  // Readiness stays pending until a test resolves or rejects it. Event-classification tests
  // inject at the scheduler seam directly; readiness behavior has its own explicit coverage.
  watch(root: string, onEvents: (events: WatchEvent[]) => void, options?: WatchOptions) {
    const ready = deferred<Result<void, unknown>>();
    const attempt: FakeWatchAttempt = {
      root,
      ignore: options?.ignore,
      onEvents,
      onError: options?.onError,
      ready,
      released: false,
    };
    const handle = {
      ready: () => ready.promise,
      release: () => {
        attempt.released = true;
        if (this.roots.get(root) === attempt) this.roots.delete(root);
        return Promise.resolve();
      },
    };
    this.roots.set(root, attempt);
    this.attempts.push(attempt);
    void ready.promise.then((attached) => {
      if (!attached.success && !attempt.released) attempt.onError?.(attached.error);
    });
    return handle;
  }

  dispose(): Promise<void> {
    return Promise.resolve();
  }

  emit(root: string, events: WatchEvent[]): void {
    this.roots.get(root)?.onEvents(events);
  }

  rejectReady(root: string, error: unknown): FakeWatchAttempt {
    const attempt = this.roots.get(root);
    if (!attempt) throw new Error(`No active watch for ${root}`);
    attempt.ready.resolve(err(error));
    return attempt;
  }

  resolveReady(root: string): FakeWatchAttempt {
    const attempt = this.roots.get(root);
    if (!attempt) throw new Error(`No active watch for ${root}`);
    attempt.ready.resolve(ok(undefined));
    return attempt;
  }

  watchCount(root: string): number {
    return this.attempts.filter((attempt) => attempt.root === root).length;
  }
}

function repoTarget(id: string, repoPath: string): ScanTarget {
  return {
    id,
    kind: 'repository',
    path: repoPath,
    parentId: null,
    gitAdminName: null,
    observedStatus: 'present',
    lastObservedAt: 0,
  };
}

function worktreeTarget(
  id: string,
  worktreePath: string,
  parentId: string,
  gitAdminName: string | null = null
): ScanTarget {
  return {
    id,
    kind: 'worktree',
    path: worktreePath,
    parentId,
    gitAdminName,
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
    // Working-tree watches follow activity, so the harness treats every target as active
    // unless a test supplies its own set. Both debounces then default to the same value so
    // tests that only tune `debounceMs` keep the timing they were written against.
    isActive: (id) => (options.active ? options.active.has(id) : true),
    debounceMs: options.debounceMs ?? 20,
    activeDebounceMs: options.activeDebounceMs ?? options.debounceMs ?? 20,
    pollIntervalMs: options.pollIntervalMs ?? 60 * 60_000,
  });
  void scheduler.start();
  return { watcher, requests, scheduler };
}

describe('WorkspaceScanScheduler', () => {
  it('applies the workspace-content and Git-metadata watch profiles', async () => {
    const repo = repoTarget('repo-1', '/repos/main');
    const worktree = worktreeTarget('wt-1', '/repos/wt', 'repo-1');
    const watcher = new FakeWatchService();
    const scheduler = new WorkspaceScanScheduler({
      watcher,
      execute: async () => {},
      listTargets: () => [repo, worktree],
      isActive: () => true,
      watchIgnore: ['**/dist/**'],
      pollIntervalMs: 60 * 60_000,
    });

    try {
      void scheduler.start();
      expect(watcher.roots.get('/repos/main')?.ignore).toEqual(['.git/**', '**/dist/**']);
      expect(watcher.roots.get('/repos/wt')?.ignore).toEqual(['.git/**', '**/dist/**']);
      expect(watcher.roots.get(path.join('/repos/main', '.git'))?.ignore).toEqual([
        'objects/**',
        'subtree-cache/**',
      ]);
    } finally {
      await scheduler.dispose();
    }
  });

  it('reports initial readiness only after every startup watch has settled', async () => {
    const repo = repoTarget('repo-1', '/repos/main');
    const watcher = new FakeWatchService();
    const requests: ScanRequest[] = [];
    const scheduler = new WorkspaceScanScheduler({
      watcher,
      execute: async (request) => {
        requests.push(request);
      },
      listTargets: () => [repo],
      isActive: () => true,
      pollIntervalMs: 60 * 60_000,
    });

    try {
      const ready = scheduler.start();
      let settled = false;
      void ready.then(() => {
        settled = true;
      });

      watcher.resolveReady('/repos/main');
      await new Promise((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);

      watcher.resolveReady(path.join('/repos/main', '.git'));
      await ready;
      expect(settled).toBe(true);
      expect(requests).toEqual([]);
    } finally {
      await scheduler.dispose();
    }
  });

  it('rescans a target when its watcher becomes ready', async () => {
    const directory: ScanTarget = {
      id: 'dir-1',
      kind: 'directory',
      path: '/plain',
      parentId: null,
      gitAdminName: null,
      observedStatus: 'present',
      lastObservedAt: 0,
    };
    const targets: ScanTarget[] = [];
    const { watcher, requests, scheduler } = createHarness(targets, { debounceMs: 1 });
    try {
      targets.push(directory);
      scheduler.syncWatches();
      expect(requests).toHaveLength(0);
      watcher.resolveReady('/plain');

      await eventually(() => {
        expect(requests).toEqual([{ kind: 'workspace', id: 'dir-1', mode: 'full' }]);
      });
    } finally {
      await scheduler.dispose();
    }
  });

  it('coalesces repository and worktree watcher readiness into one repository scan', async () => {
    const repo = repoTarget('repo-1', '/repos/main');
    const wtA = worktreeTarget('wt-a', '/worktrees/a', repo.id);
    const wtB = worktreeTarget('wt-b', '/worktrees/b', repo.id);
    const targets: ScanTarget[] = [];
    const { watcher, requests, scheduler } = createHarness(targets, { debounceMs: 5 });
    try {
      targets.push(repo, wtA, wtB);
      scheduler.syncWatches();
      watcher.resolveReady('/repos/main');
      watcher.resolveReady(path.join('/repos/main', '.git'));
      watcher.resolveReady('/worktrees/a');
      watcher.resolveReady('/worktrees/b');

      await eventually(() => {
        expect(requests).toEqual([{ kind: 'repository', id: repo.id }]);
      });
    } finally {
      await scheduler.dispose();
    }
  });

  it('falls back to a standalone scan when a watched worktree loses its parent record', async () => {
    const repo = repoTarget('repo-1', '/repos/main');
    const worktree = worktreeTarget('wt-1', '/worktrees/wt', repo.id);
    const targets = [repo, worktree];
    const { watcher, requests, scheduler } = createHarness(targets, { debounceMs: 5 });
    try {
      targets.splice(0, 1);
      scheduler.syncWatches();
      watcher.emit(worktree.path, [{ kind: 'update', path: path.join(worktree.path, 'file.txt') }]);

      await eventually(() => {
        expect(requests).toEqual([{ kind: 'workspace', id: worktree.id, mode: 'full' }]);
      });
    } finally {
      await scheduler.dispose();
    }
  });

  it('falls back to a standalone scan when a worktree parent is missing', async () => {
    const repo = repoTarget('repo-1', '/repos/main');
    repo.observedStatus = 'missing';
    const worktree = worktreeTarget('wt-1', '/worktrees/wt', repo.id);
    const { watcher, requests, scheduler } = createHarness([repo, worktree], { debounceMs: 5 });
    try {
      watcher.emit(worktree.path, [{ kind: 'update', path: path.join(worktree.path, 'file.txt') }]);

      await eventually(() => {
        expect(requests).toEqual([{ kind: 'workspace', id: worktree.id, mode: 'full' }]);
      });
    } finally {
      await scheduler.dispose();
    }
  });

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
      gitAdminName: null,
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

  it('polls a stale repository and all of its worktrees as one repository scan', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const repo = repoTarget('repo-1', '/repos/main');
    const wtA = worktreeTarget('wt-a', '/worktrees/a', repo.id);
    const wtB = worktreeTarget('wt-b', '/worktrees/b', repo.id);
    const { requests, scheduler } = createHarness([repo, wtA, wtB], {
      debounceMs: 1,
      pollIntervalMs: 25,
      block: () => gate,
    });
    try {
      await eventually(() => {
        expect(requests).toEqual([{ kind: 'repository', id: repo.id }]);
      });
    } finally {
      release();
      await scheduler.dispose();
    }
  });

  it('drops a failed watch and retries it from the polling floor without an unhandled rejection', async () => {
    const repo = repoTarget('repo-1', '/repos/main');
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const { watcher, scheduler } = createHarness([repo], { pollIntervalMs: 25 });

    try {
      expect(watcher.watchCount('/repos/main')).toBe(1);
      const failed = watcher.rejectReady('/repos/main', new Error('watch attach failed'));

      await eventually(() => {
        expect(failed.released).toBe(true);
        expect(watcher.roots.has('/repos/main')).toBe(false);
      });
      await eventually(() => expect(watcher.watchCount('/repos/main')).toBe(2));
      await new Promise((resolve) => setImmediate(resolve));

      expect(watcher.roots.has('/repos/main')).toBe(true);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
      await scheduler.dispose();
    }
  });

  it('a HEAD or reflog event under one worktree admin entry scans only that worktree, refs-only', async () => {
    const repo = repoTarget('repo-1', '/repos/main');
    const wtA = worktreeTarget('wt-a', '/worktrees/a', 'repo-1', 'a');
    const wtB = worktreeTarget('wt-b', '/worktrees/b', 'repo-1', 'b');
    const { watcher, requests, scheduler } = createHarness([repo, wtA, wtB]);
    try {
      const gitDir = path.join('/repos/main', '.git');
      watcher.emit(gitDir, [
        { kind: 'update', path: path.join(gitDir, 'worktrees/a/HEAD') },
        { kind: 'update', path: path.join(gitDir, 'worktrees/a/logs/HEAD') },
      ]);
      await eventually(() => {
        // Localized to the one worktree that moved — no repository reconcile, no fanout.
        expect(requests).toEqual([{ kind: 'workspace', id: 'wt-a', mode: 'refs' }]);
      });
    } finally {
      await scheduler.dispose();
    }
  });

  it('an index event under a worktree admin entry triggers nothing', async () => {
    const repo = repoTarget('repo-1', '/repos/main');
    const wtA = worktreeTarget('wt-a', '/worktrees/a', 'repo-1', 'a');
    const { watcher, requests, scheduler } = createHarness([repo, wtA], { debounceMs: 5 });
    try {
      const gitDir = path.join('/repos/main', '.git');
      watcher.emit(gitDir, [{ kind: 'update', path: path.join(gitDir, 'worktrees/a/index') }]);
      await new Promise((resolve) => setTimeout(resolve, 50));
      // Staged-only staleness is corrected by the poll floor; the working-tree
      // watch covers real file changes.
      expect(requests).toHaveLength(0);
    } finally {
      await scheduler.dispose();
    }
  });

  it('membership changes (admin entry or gitdir appearing/disappearing) still reconcile the repo', async () => {
    const repo = repoTarget('repo-1', '/repos/main');
    const wtA = worktreeTarget('wt-a', '/worktrees/a', 'repo-1', 'a');
    const { watcher, requests, scheduler } = createHarness([repo, wtA]);
    try {
      const gitDir = path.join('/repos/main', '.git');
      watcher.emit(gitDir, [{ kind: 'delete', path: path.join(gitDir, 'worktrees/a') }]);
      await eventually(() => {
        expect(requests).toEqual([{ kind: 'repository', id: 'repo-1' }]);
      });
    } finally {
      await scheduler.dispose();
    }
  });

  it('a HEAD event for an unknown admin entry falls back to repository reconcile', async () => {
    const repo = repoTarget('repo-1', '/repos/main');
    const { watcher, requests, scheduler } = createHarness([repo]);
    try {
      const gitDir = path.join('/repos/main', '.git');
      // No registered target carries this admin name — membership knowledge is stale.
      watcher.emit(gitDir, [{ kind: 'update', path: path.join(gitDir, 'worktrees/ghost/HEAD') }]);
      await eventually(() => {
        expect(requests).toEqual([{ kind: 'repository', id: 'repo-1' }]);
      });
    } finally {
      await scheduler.dispose();
    }
  });

  it('muted ids drop watcher-driven requests until released; the repo mute silences its fanout', async () => {
    const repo = repoTarget('repo-1', '/repos/main');
    const wt = worktreeTarget('wt-1', '/worktrees/wt', 'repo-1', 'wt');
    const { watcher, requests, scheduler } = createHarness([repo, wt], { debounceMs: 5 });
    try {
      const gitDir = path.join('/repos/main', '.git');

      // Muting the worktree drops its working-tree events (the artifact copy case).
      const releaseWorktree = scheduler.mute('wt-1');
      watcher.emit('/worktrees/wt', [{ kind: 'create', path: '/worktrees/wt/node_modules/x' }]);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(requests).toHaveLength(0);

      // Muting the repository silences gitdir classification wholesale, fanout included
      // (the background fetch/push case).
      const releaseRepo = scheduler.mute('repo-1');
      watcher.emit(gitDir, [{ kind: 'update', path: path.join(gitDir, 'packed-refs') }]);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(requests).toHaveLength(0);

      releaseWorktree();
      releaseRepo();
      watcher.emit(gitDir, [{ kind: 'update', path: path.join(gitDir, 'packed-refs') }]);
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

  it('mute is refcounted: overlapping holds only release when the last one does', async () => {
    const repo = repoTarget('repo-1', '/repos/main');
    const { watcher, requests, scheduler } = createHarness([repo], { debounceMs: 5 });
    try {
      const first = scheduler.mute('repo-1');
      const second = scheduler.mute('repo-1');
      first();
      first(); // double release of one hold must not free the other
      watcher.emit('/repos/main', [{ kind: 'update', path: '/repos/main/a.txt' }]);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(requests).toHaveLength(0);

      second();
      watcher.emit('/repos/main', [{ kind: 'update', path: '/repos/main/a.txt' }]);
      await eventually(() => {
        expect(requests).toEqual([{ kind: 'workspace', id: 'repo-1', mode: 'full' }]);
      });
    } finally {
      await scheduler.dispose();
    }
  });

  it('holds working-tree watches only for active workspaces, metadata watches always', async () => {
    const repo = repoTarget('repo-1', '/repos/main');
    const activeWorktree = worktreeTarget('wt-a', '/worktrees/a', 'repo-1');
    const idleWorktree = worktreeTarget('wt-b', '/worktrees/b', 'repo-1');
    const { watcher, scheduler } = createHarness([repo, activeWorktree, idleWorktree], {
      active: new Set(['wt-a']),
    });
    try {
      // The idle repository keeps its `.git` watch but not its working-tree watch.
      expect([...watcher.roots.keys()].sort()).toEqual([
        path.join('/repos/main', '.git'),
        '/worktrees/a',
      ]);
    } finally {
      await scheduler.dispose();
    }
  });

  it('adds a working-tree watch on activation and scans once it attaches', async () => {
    const repo = repoTarget('repo-1', '/repos/main');
    const worktree = worktreeTarget('wt-1', '/worktrees/wt', 'repo-1');
    const active = new Set<string>();
    const { watcher, requests, scheduler } = createHarness([repo, worktree], {
      active,
      debounceMs: 1,
    });
    try {
      expect(watcher.roots.has('/worktrees/wt')).toBe(false);

      active.add('wt-1');
      scheduler.syncWatches();
      expect(watcher.roots.has('/worktrees/wt')).toBe(true);
      expect(requests).toHaveLength(0);

      // Changes may have landed while the workspace was idle and unwatched: attaching
      // reconciles once, and a worktree with a present parent scans as that repository.
      watcher.resolveReady('/worktrees/wt');
      await eventually(() => {
        expect(requests).toEqual([{ kind: 'repository', id: 'repo-1' }]);
      });
    } finally {
      await scheduler.dispose();
    }
  });

  it('releases the working-tree watch once a workspace goes idle', async () => {
    const worktree = worktreeTarget('wt-1', '/worktrees/wt', 'repo-1');
    const active = new Set(['wt-1']);
    const { watcher, scheduler } = createHarness([worktree], { active });
    try {
      const attempt = watcher.roots.get('/worktrees/wt');
      expect(attempt).toBeDefined();

      active.delete('wt-1');
      scheduler.syncWatches();
      expect(attempt?.released).toBe(true);
      expect(watcher.roots.has('/worktrees/wt')).toBe(false);
    } finally {
      await scheduler.dispose();
    }
  });

  it('keeps polling idle workspaces so they stay eventually consistent unwatched', async () => {
    const worktree = worktreeTarget('wt-1', '/worktrees/wt', 'repo-1');
    const { watcher, requests, scheduler } = createHarness([worktree], {
      active: new Set(),
      debounceMs: 1,
      pollIntervalMs: 25,
    });
    try {
      expect(watcher.roots.size).toBe(0);
      await eventually(() => {
        expect(requests).toContainEqual({ kind: 'workspace', id: 'wt-1', mode: 'full' });
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
