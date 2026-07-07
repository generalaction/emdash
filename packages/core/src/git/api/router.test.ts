import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { MessageChannel } from 'node:worker_threads';
import type { Result } from '@emdash/shared';
import { createORPCClient, type Client } from '@orpc/client';
import { RPCLink } from '@orpc/client/message-port';
import { describe, expect, it, vi } from 'vitest';
import type { IWatchService } from '../../watch';
import type { CheckoutStatusModel } from '../checkout/models/status';
import type { IGitCheckout } from '../checkout/types';
import { GitRuntime } from '../git-runtime';
import type { GitRefsModel } from '../repository/models/refs';
import type { IGitRuntime } from '../types';
import type { GitLogOptions } from './commands';
import type { PullError, PushError } from './errors';
import type { GitTransferProgress, PullJobInput, PushJobInput } from './jobs';
import { serveGitPort } from './router';

const execFileAsync = promisify(execFile);

type Proc<I = unknown, O = unknown> = Client<Record<never, never>, I, O, unknown>;
type LiveSnapshot<T> = { data: T; sequence: number; generation: number; timestamp: number };
type LiveUpdate = { delta: unknown };
type LiveJobState<P, R, E> =
  | { status: 'running'; startedAt: number; progress: P[]; progressCount: number }
  | { status: 'succeeded'; result: R }
  | { status: 'failed'; error: E }
  | { status: 'cancelled' };
type JobClient<I, P, R, E> = {
  start: Proc<I, { jobId: string }>;
  cancel: Proc<{ jobId: string }, void>;
  snapshot: Proc<{ jobId: string }, LiveSnapshot<LiveJobState<P, R, E>>>;
  subscribe: Proc<{ jobId: string }, AsyncIterator<LiveUpdate>>;
  unsubscribe: Proc<{ jobId: string }, void>;
};

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
    push: JobClient<PushJobInput, GitTransferProgress, { output: string }, PushError>;
    pull: JobClient<PullJobInput, GitTransferProgress, { output: string }, PullError>;
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

function fakeRuntimeWithCheckout(checkout: Partial<IGitCheckout>) {
  return {
    openCheckout: vi.fn(async () => ({
      value: checkout as IGitCheckout,
      release: vi.fn(async () => {}),
    })),
  } as unknown as IGitRuntime;
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

function makeClient(runtime: IGitRuntime) {
  const { port1, port2 } = new MessageChannel();
  const session = serveGitPort(runtime, port1);
  port1.start();
  const link = new RPCLink({ port: port2 });
  const client = createORPCClient<TestGitClient>(link);
  return {
    client,
    serverPort: port1,
    close: async () => {
      port1.close();
      port2.close();
      await session.dispose();
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
    },
  };
}

async function makeRepoWithRemote(): Promise<{ repo: string; remote: string }> {
  const repo = await makeRepo();
  const remote = await mkdtemp(path.join(tmpdir(), 'emdash-git-router-remote-'));
  await execFileAsync('git', ['init', '--bare'], { cwd: remote });
  await execFileAsync('git', ['remote', 'add', 'origin', remote], { cwd: repo });
  return { repo, remote };
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
  }
}

async function waitForTerminalJob<I, P, R, E>(
  job: JobClient<I, P, R, E>,
  jobId: string
): Promise<Exclude<LiveJobState<P, R, E>, { status: 'running' }>> {
  const updates = await job.subscribe({ jobId });
  try {
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const snapshot = await job.snapshot({ jobId });
      if (snapshot.data.status !== 'running') return snapshot.data;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 10);
      });
    }
    throw new Error(`Timed out waiting for job ${jobId}`);
  } finally {
    await updates.return?.(undefined);
  }
}

describe('gitRouter', () => {
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

  it('releases retained repository and checkout leases when the server port closes', async () => {
    const repo = await makeRepo();
    let releaseCount = 0;
    const runtime = new GitRuntime({
      watcher: createNoopWatcher(() => {
        releaseCount += 1;
      }),
    });
    const { client, close, serverPort } = makeClient(runtime);

    try {
      await client.repository.refs.snapshot({ repositoryRoot: repo });
      await client.checkout.status.snapshot({ checkoutPath: repo });

      serverPort.close();

      await waitFor(
        () => releaseCount === 2,
        `Expected server port close to release 2 retained leases, got ${releaseCount}`
      );
    } finally {
      await close();
      await runtime.dispose();
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('evicts failed checkout opens so a later request retries the same key', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'emdash-git-router-non-repo-'));
    const runtime = new GitRuntime({ watcher: createNoopWatcher() });
    const { client, close } = makeClient(runtime);

    try {
      await expect(client.checkout.status.snapshot({ checkoutPath: directory })).rejects.toThrow();

      await execFileAsync('git', ['init', '-b', 'main'], { cwd: directory });
      await execFileAsync('git', ['config', 'user.email', 'test@example.com'], {
        cwd: directory,
      });
      await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: directory });

      const status = await client.checkout.status.snapshot({ checkoutPath: directory });

      expect(status.data.kind).toBe('ok');
    } finally {
      await close();
      await runtime.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('coalesces concurrent checkout requests for the same key within one session', async () => {
    const repo = await makeRepo();
    const runtime = new GitRuntime({ watcher: createNoopWatcher() });
    const originalOpenCheckout: GitRuntime['openCheckout'] = runtime.openCheckout.bind(runtime);
    let openCount = 0;
    runtime.openCheckout = async (checkoutPath) => {
      openCount += 1;
      return originalOpenCheckout(checkoutPath);
    };
    const { client, close } = makeClient(runtime);

    try {
      const [first, second] = await Promise.all([
        client.checkout.status.snapshot({ checkoutPath: repo }),
        client.checkout.status.snapshot({ checkoutPath: repo }),
      ]);

      expect(first.data.kind).toBe('ok');
      expect(second.data.kind).toBe('ok');
      expect(openCount).toBe(1);
    } finally {
      await close();
      await runtime.dispose();
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('runs checkout push as a job and exposes the terminal result', async () => {
    const { repo, remote } = await makeRepoWithRemote();
    const runtime = new GitRuntime({ watcher: createNoopWatcher() });
    const { client, close } = makeClient(runtime);

    try {
      const { jobId } = await client.checkout.push.start({
        checkoutPath: repo,
        options: { remote: 'origin', setUpstream: true },
      });
      const terminal = await waitForTerminalJob(client.checkout.push, jobId);

      expect(terminal).toMatchObject({
        status: 'succeeded',
        result: { output: expect.any(String) },
      });
      await expect(
        execFileAsync('git', ['--git-dir', remote, 'rev-parse', 'refs/heads/main'])
      ).resolves.toMatchObject({ stdout: expect.stringMatching(/[a-f0-9]{40}/) });
    } finally {
      await close();
      await runtime.dispose();
      await rm(repo, { recursive: true, force: true });
      await rm(remote, { recursive: true, force: true });
    }
  });

  it('cancels checkout jobs through the router', async () => {
    const checkout = {
      pull: vi.fn(
        (_context?: unknown): Promise<Result<{ output: string }, PullError>> =>
          new Promise((_resolve, reject) => {
            const signal = (_context as { signal?: AbortSignal } | undefined)?.signal;
            signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
          })
      ),
    };
    const runtime = fakeRuntimeWithCheckout(checkout);
    const { client, close } = makeClient(runtime);

    try {
      const { jobId } = await client.checkout.pull.start({ checkoutPath: '/repo' });
      await vi.waitFor(() => expect(checkout.pull).toHaveBeenCalled());

      await client.checkout.pull.cancel({ jobId });

      await expect(waitForTerminalJob(client.checkout.pull, jobId)).resolves.toEqual({
        status: 'cancelled',
      });
    } finally {
      await close();
    }
  });
});
