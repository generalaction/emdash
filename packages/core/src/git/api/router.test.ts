import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { MessageChannel } from 'node:worker_threads';
import { createORPCClient, type Client } from '@orpc/client';
import { RPCLink } from '@orpc/client/message-port';
import { describe, expect, it } from 'vitest';
import type { IWatchService } from '../../watch';
import type { CheckoutStatusModel } from '../checkout/models/status';
import { GitRuntime } from '../git-runtime';
import type { GitRefsModel } from '../repository/models/refs';
import type { GitLogOptions } from './commands';
import { createGitRouter, serveGitPort } from './router';

const execFileAsync = promisify(execFile);

type Proc<I = unknown, O = unknown> = Client<Record<never, never>, I, O, unknown>;
type LiveSnapshot<T> = { data: T; sequence: number; generation: number; timestamp: number };
type LiveUpdate = { delta: unknown };

type TestGitClient = {
  repository: {
    refs: {
      snapshot: Proc<{ repositoryRoot: string }, LiveSnapshot<GitRefsModel>>;
    };
  };
  checkout: {
    status: {
      snapshot: Proc<{ checkoutPath: string }, LiveSnapshot<CheckoutStatusModel>>;
      subscribe: Proc<{ checkoutPath: string }, AsyncIterator<LiveUpdate>>;
    };
    stage: Proc<{ checkoutPath: string; paths: string[] }, { success: boolean }>;
    getLog: Proc<
      { checkoutPath: string; options?: GitLogOptions },
      { commits: Array<{ subject: string }> }
    >;
  };
};

async function makeRepo(): Promise<string> {
  const repo = await mkdtemp(path.join(tmpdir(), 'emdash-git-router-'));
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: repo });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: repo });
  await writeFile(path.join(repo, 'tracked.txt'), 'before\n', 'utf8');
  await execFileAsync('git', ['add', 'tracked.txt'], { cwd: repo });
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: repo });
  return await realpath(repo);
}

function createNoopWatcher(onRelease?: () => void): IWatchService {
  return {
    watch: () => ({
      ready: async () => {},
      release: async () => {
        onRelease?.();
      },
    }),
    dispose: async () => {},
  };
}

function makeClient(runtime: GitRuntime) {
  const { port1, port2 } = new MessageChannel();
  const handle = createGitRouter(runtime);
  serveGitPort(handle.router, port1);
  port1.start();
  const link = new RPCLink({ port: port2 });
  const client = createORPCClient<TestGitClient>(link);
  return {
    client,
    handle,
    close: async () => {
      await handle.dispose();
      port1.close();
      port2.close();
    },
  };
}

describe('createGitRouter', () => {
  it('serves live snapshots and streams checkout status updates', async () => {
    const repo = await makeRepo();
    const runtime = new GitRuntime({ watcher: createNoopWatcher() });
    const { client, close } = makeClient(runtime);

    try {
      const refs = await client.repository.refs.snapshot({ repositoryRoot: repo });
      expect(refs.data.branches).toEqual([
        expect.objectContaining({ type: 'local', branch: 'main' }),
      ]);

      await writeFile(path.join(repo, 'tracked.txt'), 'after\n', 'utf8');
      const updates = await client.checkout.status.subscribe({ checkoutPath: repo });
      const stageResult = await client.checkout.stage({
        checkoutPath: repo,
        paths: ['tracked.txt'],
      });
      expect(stageResult.success).toBe(true);

      const update = await updates.next();
      expect(update.done).toBe(false);
      expect(update.value.delta).toBeTruthy();

      const status = await client.checkout.status.snapshot({ checkoutPath: repo });
      expect(status.data.kind).toBe('ok');
      if (status.data.kind !== 'ok') throw new Error(`Expected ok status, got ${status.data.kind}`);
      expect(status.data.entries[path.join(repo, 'tracked.txt')]).toMatchObject({
        index: 'modified',
        worktree: 'unmodified',
      });

      await updates.return?.(undefined);
    } finally {
      await close();
      await runtime.dispose();
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('delegates checkout queries', async () => {
    const repo = await makeRepo();
    const runtime = new GitRuntime({ watcher: createNoopWatcher() });
    const { client, close } = makeClient(runtime);

    try {
      const log = await client.checkout.getLog({ checkoutPath: repo, options: { limit: 1 } });

      expect(log.commits).toHaveLength(1);
      expect(log.commits[0]?.subject).toBe('initial');
      expect(log).not.toHaveProperty('aheadCount');
    } finally {
      await close();
      await runtime.dispose();
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('releases retained repository and checkout leases on dispose', async () => {
    const repo = await makeRepo();
    let releaseCount = 0;
    const runtime = new GitRuntime({
      watcher: createNoopWatcher(() => {
        releaseCount += 1;
      }),
    });
    const { client, close } = makeClient(runtime);

    try {
      await client.repository.refs.snapshot({ repositoryRoot: repo });
      await client.checkout.status.snapshot({ checkoutPath: repo });

      await close();

      expect(releaseCount).toBe(2);
    } finally {
      await runtime.dispose();
      await rm(repo, { recursive: true, force: true });
    }
  });
});
