import { err, ok } from '@emdash/shared';
import { createScope } from '@emdash/shared/concurrency';
import { deferred } from '@emdash/shared/testing';
import { snapshot } from '@emdash/wire/state';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gitPath, hostPath } from '#runtimes/git/node/testing/paths';
import type { BoundExec } from '#services/exec/api';
import {
  gitMetadataWatchProfile,
  workspaceContentWatchIgnore,
  type IWatchService,
  type WatchOptions,
} from '#services/fs-watch/api';
import { GitAllocationGraph } from './allocation-graph';
import type { CheckoutIdentity, GitIdentityResolver } from './identity';

const identity = {
  repositoryId: '/repo/.git',
  objectStoreId: '/repo/.git/objects',
  checkoutId: '["/repo","/repo/.git"]',
  checkoutRoot: '/repo',
  gitDir: '/repo/.git',
  gitCommonDir: '/repo/.git',
  objectStoreDir: '/repo/.git/objects',
} as CheckoutIdentity;

const resolver: GitIdentityResolver = {
  resolve: async () => ok(identity),
  dispose: () => {},
};

const exec: BoundExec = {
  file: 'git',
  cwd: '/',
  exec: async () => {
    throw new Error('unexpected Git execution');
  },
  execStreaming: async () => {
    throw new Error('unexpected Git execution');
  },
  execBuffer: async () => {
    throw new Error('unexpected Git execution');
  },
  spawn: () => {
    throw new Error('unexpected Git execution');
  },
  withCwd() {
    return this;
  },
};

describe('GitAllocationGraph', () => {
  afterEach(() => vi.useRealTimers());

  it('loads diff content while a background repository job is still running', async () => {
    const background = deferred<void>();
    const started = deferred<void>();
    const read = vi.fn(async () => ({ stdout: Buffer.from('before\n'), stderr: '' }));
    const graph = new GitAllocationGraph({
      exec: {
        ...exec,
        exec: async () => ({ stdout: 'blob-oid\n', stderr: '' }),
        execBuffer: read,
      },
      watcher: {
        watch: () => ({ ready: () => new Promise(() => {}), release: async () => {} }),
        dispose: async () => {},
      },
      identityResolver: resolver,
    });
    const scope = createScope();
    const lease = graph.acquireCheckout({ checkout: hostPath('/repo') });
    try {
      const checkout = await lease.ready();
      const job = checkout.repository.execute(async () => {
        started.resolve();
        await background.promise;
      });
      await started.promise;
      const content = checkout.fileContent(
        { path: gitPath('a.txt'), source: { kind: 'head' } },
        scope
      );
      const refreshed = content.refresh();
      await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
      await refreshed;
      expect(snapshot(content).value).toMatchObject({ kind: 'text', content: 'before\n' });
      background.resolve();
      await job;
    } finally {
      background.resolve();
      await scope.dispose();
      await lease.release();
      await graph.dispose();
    }
  });

  it('bounds repository content reads and drops cancelled queued reads', async () => {
    const graph = new GitAllocationGraph({
      exec,
      watcher: {
        watch: () => ({ ready: () => new Promise(() => {}), release: async () => {} }),
        dispose: async () => {},
      },
      identityResolver: resolver,
    });
    const lease = graph.acquireRepository({ repository: hostPath('/repo') });
    const release = deferred<void>();
    try {
      const repository = await lease.ready();
      const signal = new AbortController().signal;
      const started: string[] = [];
      const read = (name: string, readSignal = signal) =>
        repository.readContent(readSignal, async () => {
          started.push(name);
          await release.promise;
        });
      const first = read('first');
      const second = read('second');
      const cancelled = new AbortController();
      const third = read('cancelled', cancelled.signal);
      const rejection = expect(third).rejects.toThrow('no longer visible');
      const fourth = read('fourth');
      await vi.waitFor(() => expect(started).toEqual(['first', 'second']));
      cancelled.abort(new Error('no longer visible'));
      await rejection;
      expect(started).toEqual(['first', 'second']);
      release.resolve();
      await Promise.all([first, second, fourth]);
      expect(started).toEqual(['first', 'second', 'fourth']);
    } finally {
      release.resolve();
      await lease.release();
      await graph.dispose();
    }
  });

  it('cancels active and queued content reads when the repository is disposed', async () => {
    const graph = new GitAllocationGraph({
      exec,
      watcher: {
        watch: () => ({ ready: () => new Promise(() => {}), release: async () => {} }),
        dispose: async () => {},
      },
      identityResolver: resolver,
    });
    const lease = graph.acquireRepository({ repository: hostPath('/repo') });
    const repository = await lease.ready();
    const started: AbortSignal[] = [];
    const read = () =>
      repository.readContent(new AbortController().signal, async (signal) => {
        started.push(signal);
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true })
        );
        return 'cancelled';
      });
    const reads = [read(), read(), read()];
    const results = Promise.allSettled(reads);
    await vi.waitFor(() => expect(started).toHaveLength(2));
    await graph.dispose();
    await results;
    expect(started).toHaveLength(2);
    expect(started.every((signal) => signal.aborted)).toBe(true);
    await lease.release();
  });

  it('cancels a content read once its last owner releases it', async () => {
    const reads: { spec: string; signal: AbortSignal }[] = [];
    const graph = new GitAllocationGraph({
      exec: {
        ...exec,
        exec: (args, options) => {
          const signal = options?.signal ?? new AbortController().signal;
          reads.push({ spec: args[args.length - 1], signal });
          return new Promise((_, reject) =>
            signal.addEventListener('abort', () => reject(signal.reason), { once: true })
          );
        },
      },
      watcher: {
        watch: () => ({ ready: () => new Promise(() => {}), release: async () => {} }),
        dispose: async () => {},
      },
      identityResolver: resolver,
    });
    const lease = graph.acquireCheckout({ checkout: hostPath('/repo') });
    const owners: ReturnType<typeof createScope>[] = [];
    const open = (checkout: Awaited<ReturnType<typeof lease.ready>>, path: string) => {
      const owner = createScope();
      owners.push(owner);
      const content = checkout.fileContent(
        { path: gitPath(path), source: { kind: 'head' } },
        owner
      );
      void content.refresh().catch(() => {});
      return owner;
    };
    try {
      const checkout = await lease.ready();
      const closed = [open(checkout, 'a.txt'), open(checkout, 'b.txt')];
      await vi.waitFor(() => expect(reads).toHaveLength(2));
      await Promise.all(closed.map((owner) => owner.dispose()));
      await vi.waitFor(() => expect(reads.every((read) => read.signal.aborted)).toBe(true));

      open(checkout, 'c.txt');
      open(checkout, 'a.txt');
      await vi.waitFor(() =>
        expect(reads.slice(2).map((read) => read.spec)).toEqual(['HEAD:c.txt', 'HEAD:a.txt'])
      );
      expect(reads.slice(2).some((read) => read.signal.aborted)).toBe(false);
    } finally {
      await Promise.all(owners.map((owner) => owner.dispose()));
      await lease.release();
      await graph.dispose();
    }
  });

  it('evicts failed mount creation so the same selector can retry', async () => {
    let fail = true;
    const watcher: IWatchService = {
      watch: () => {
        if (fail) throw new Error('watch failed');
        return { ready: async () => ok(undefined), release: async () => {} };
      },
      dispose: async () => {},
    };
    const graph = new GitAllocationGraph({ exec, watcher, identityResolver: resolver });
    const selector = { repository: hostPath('/repo') };

    await expect(graph.acquireRepository(selector).ready()).rejects.toThrow('watch failed');
    fail = false;
    const retry = graph.acquireRepository(selector);
    await expect(retry.ready()).resolves.toMatchObject({
      identity: { repositoryId: identity.repositoryId },
    });
    await retry.release();
    await graph.dispose();
  });

  it('allocates a checkout when watcher readiness returns a failure Result', async () => {
    const failure = new Error('watch attach failed');
    const errors: string[] = [];
    const released: string[] = [];
    const watcher: IWatchService = {
      watch: (root) => ({
        ready: async () => err(failure),
        release: async () => {
          released.push(root);
        },
      }),
      dispose: async () => {},
    };
    const graph = new GitAllocationGraph({
      exec,
      watcher,
      identityResolver: resolver,
      onError: (context, error) => errors.push(`${context}: ${String(error)}`),
    });

    const lease = graph.acquireCheckout({ checkout: hostPath('/repo') });
    await expect(lease.ready()).resolves.toMatchObject({
      identity: { checkoutId: identity.checkoutId },
    });
    await vi.waitFor(() => expect(errors).toHaveLength(2));
    expect(errors).toEqual([
      'watch /repo/.git: Error: watch attach failed',
      'watch /repo: Error: watch attach failed',
    ]);
    // A failed handle is held, not released, so the shared subscription keeps its demand.
    expect(released).toEqual([]);
    await lease.release();
    await graph.dispose();
    expect(released).toEqual(['/repo', '/repo/.git']);
  });

  it('allocates a checkout while watcher readiness is still pending', async () => {
    const watcher: IWatchService = {
      watch: () => ({
        ready: () => new Promise(() => {}),
        release: async () => {},
      }),
      dispose: async () => {},
    };
    const graph = new GitAllocationGraph({ exec, watcher, identityResolver: resolver });

    const lease = graph.acquireCheckout({ checkout: hostPath('/repo') });
    await expect(lease.ready()).resolves.toMatchObject({
      identity: { checkoutId: identity.checkoutId },
    });
    await lease.release();
    await graph.dispose();
  });

  it('applies the Git-metadata and workspace-content watch profiles', async () => {
    const watches = new Map<string, Pick<WatchOptions, 'ignore' | 'backend'>>();
    const watcher: IWatchService = {
      watch: (root, _onEvents, options) => {
        watches.set(root, { ignore: options?.ignore, backend: options?.backend });
        return { ready: async () => ok(undefined), release: async () => {} };
      },
      dispose: async () => {},
    };
    const graph = new GitAllocationGraph({
      exec,
      watcher,
      identityResolver: resolver,
      watchIgnoreGlobs: ['**/dist/**'],
    });

    const lease = graph.acquireCheckout({ checkout: hostPath('/repo') });
    await lease.ready();
    expect(watches.get('/repo/.git')).toEqual(gitMetadataWatchProfile());
    expect(watches.get('/repo/.git')?.backend).toBe('os');
    expect(watches.get('/repo')).toEqual({
      ignore: workspaceContentWatchIgnore(['**/dist/**']),
      backend: undefined,
    });
    expect(watches.get('/repo')?.ignore).toEqual(['.git/**', '**/dist/**']);
    await lease.release();
    await graph.dispose();
  });

  it('retains the parent repository until an idle checkout is disposed', async () => {
    vi.useFakeTimers();
    const released: string[] = [];
    const watcher: IWatchService = {
      watch: (root) => ({
        ready: async () => ok(undefined),
        release: async () => {
          released.push(root);
        },
      }),
      dispose: async () => {},
    };
    const graph = new GitAllocationGraph({
      exec,
      watcher,
      identityResolver: resolver,
      idleTtlMs: 50,
    });
    const lease = graph.acquireCheckout({ checkout: hostPath('/repo') });
    await lease.ready();
    await lease.release();

    await vi.advanceTimersByTimeAsync(49);
    expect(released).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(released).toEqual(['/repo']);
    await vi.advanceTimersByTimeAsync(50);
    expect(released).toEqual(['/repo', '/repo/.git']);
    await graph.dispose();
  });
});
