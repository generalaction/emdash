import { ok } from '@emdash/shared';
import { hostPath } from '@runtimes/git/node/testing/paths';
import type { BoundExec } from '@services/exec/api';
import type { IWatchService } from '@services/fs-watch/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('evicts failed mount creation so the same selector can retry', async () => {
    let fail = true;
    const watcher: IWatchService = {
      watch: () => {
        if (fail) throw new Error('watch failed');
        return { ready: async () => {}, release: async () => {} };
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

  it('retains the parent repository until an idle checkout is disposed', async () => {
    vi.useFakeTimers();
    const released: string[] = [];
    const watcher: IWatchService = {
      watch: (root) => ({
        ready: async () => {},
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
