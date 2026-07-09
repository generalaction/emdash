import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Result } from '@emdash/shared';
import {
  client,
  connect,
  createLiveJobReplica,
  memoryTransportPair,
  serve,
  type LiveUpdate,
} from '@emdash/wire';
import { describe, expect, it } from 'vitest';
import type { IWatchService } from '../../watch';
import { GitRuntime } from '../git-runtime';
import { gitContract } from './contract';
import { createGitController } from './controller';

const execFileAsync = promisify(execFile);

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.success) throw result.error;
  return result.data;
}

function makeClient(runtime: GitRuntime) {
  const pair = memoryTransportPair();
  const controller = createGitController(runtime);
  const stop = serve(pair.right, controller);
  const contractClient = client(gitContract, connect(pair.left));
  return {
    client: contractClient,
    dispose: () => {
      stop();
      controller.dispose?.();
    },
  };
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

async function makeRepo(): Promise<string> {
  const repo = await mkdtemp(path.join(tmpdir(), 'emdash-git-controller-'));
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: repo });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: repo });
  await writeFile(path.join(repo, 'tracked.txt'), 'before\n', 'utf8');
  await execFileAsync('git', ['add', 'tracked.txt'], { cwd: repo });
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: repo });
  return await realpath(repo);
}

async function makeRepoWithRemote(): Promise<{ repo: string; remote: string }> {
  const repo = await makeRepo();
  const remote = await mkdtemp(path.join(tmpdir(), 'emdash-git-controller-remote-'));
  await execFileAsync('git', ['init', '--bare'], { cwd: remote });
  await execFileAsync('git', ['remote', 'add', 'origin', remote], { cwd: repo });
  return { repo, remote };
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

describe('createGitController', () => {
  it('serves live snapshots and streams checkout status updates through a mutation', async () => {
    const repo = await makeRepo();
    const runtime = new GitRuntime({ watcher: createNoopWatcher() });
    const { client: git, dispose } = makeClient(runtime);

    try {
      const repoKey = unwrap(await git.repository.open({ path: repo }));
      const refs = await git.repository.model.state(repoKey, 'refs').snapshot();
      expect(refs.data.branches).toEqual([
        expect.objectContaining({ type: 'local', branch: 'main' }),
      ]);

      const checkoutKey = unwrap(await git.checkout.open({ path: repo }));
      await writeFile(path.join(repo, 'tracked.txt'), 'after\n', 'utf8');

      const updates: LiveUpdate[] = [];
      const detach = await git.checkout.model
        .state(checkoutKey, 'status')
        .attach((update) => updates.push(update));

      const stageResult = await git.checkout.model.mutate('stage', {
        key: checkoutKey,
        input: { paths: ['tracked.txt'] },
      });
      expect(stageResult.success).toBe(true);

      await waitFor(() => updates.length > 0, 'expected a status update after staging');

      const status = await git.checkout.model.state(checkoutKey, 'status').snapshot();
      expect(status.data.kind).toBe('ok');
      if (status.data.kind !== 'ok') throw new Error(`Expected ok status, got ${status.data.kind}`);
      expect(status.data.entries[path.join(repo, 'tracked.txt')]).toMatchObject({
        index: 'modified',
        worktree: 'unmodified',
      });

      await detach();
      await git.checkout.close(checkoutKey);
      await git.repository.close(repoKey);
    } finally {
      dispose();
      await runtime.dispose();
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('delegates checkout queries', async () => {
    const repo = await makeRepo();
    const runtime = new GitRuntime({ watcher: createNoopWatcher() });
    const { client: git, dispose } = makeClient(runtime);

    try {
      const checkoutKey = unwrap(await git.checkout.open({ path: repo }));
      const log = unwrap(await git.checkout.getLog({ ...checkoutKey, options: { limit: 1 } }));
      expect(log.commits).toHaveLength(1);
      expect(log.commits[0]?.subject).toBe('initial');
      await git.checkout.close(checkoutKey);
    } finally {
      dispose();
      await runtime.dispose();
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('releases retained repository and checkout sessions when the runtime is disposed', async () => {
    const repo = await makeRepo();
    let releaseCount = 0;
    const runtime = new GitRuntime({
      watcher: createNoopWatcher(() => {
        releaseCount += 1;
      }),
    });
    const { client: git, dispose } = makeClient(runtime);

    try {
      unwrap(await git.repository.open({ path: repo }));
      unwrap(await git.checkout.open({ path: repo }));

      await runtime.dispose();

      await waitFor(
        () => releaseCount === 2,
        `Expected runtime dispose to release 2 retained watch handles, got ${releaseCount}`
      );
    } finally {
      dispose();
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('evicts failed opens so a later request retries the same key', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'emdash-git-controller-non-repo-'));
    const runtime = new GitRuntime({ watcher: createNoopWatcher() });
    const { client: git, dispose } = makeClient(runtime);

    try {
      const failed = await git.checkout.open({ path: directory });
      expect(failed.success).toBe(false);

      await execFileAsync('git', ['init', '-b', 'main'], { cwd: directory });
      await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: directory });
      await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: directory });

      const opened = await git.checkout.open({ path: directory });
      expect(opened.success).toBe(true);
    } finally {
      dispose();
      await runtime.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('runs checkout push as a job and exposes the terminal result', async () => {
    const { repo, remote } = await makeRepoWithRemote();
    const runtime = new GitRuntime({ watcher: createNoopWatcher() });
    const { client: git, dispose } = makeClient(runtime);
    const jobs = createLiveJobReplica(gitContract.checkout.push, git.checkout.push);

    try {
      const checkoutKey = unwrap(await git.checkout.open({ path: repo }));
      const lease = await jobs.start({
        checkoutPath: checkoutKey.checkoutPath,
        options: { remote: 'origin', setUpstream: true },
      });
      const handle = await lease.ready();

      await expect(handle.result).resolves.toMatchObject({ output: expect.any(String) });
      await expect(
        execFileAsync('git', ['--git-dir', remote, 'rev-parse', 'refs/heads/main'])
      ).resolves.toMatchObject({ stdout: expect.stringMatching(/[a-f0-9]{40}/) });

      await lease.release();
      await git.checkout.close(checkoutKey);
    } finally {
      await jobs.dispose();
      dispose();
      await runtime.dispose();
      await rm(repo, { recursive: true, force: true });
      await rm(remote, { recursive: true, force: true });
    }
  });

  it('fails checkout jobs fast when the session is not open', async () => {
    const runtime = new GitRuntime({ watcher: createNoopWatcher() });
    const { client: git, dispose } = makeClient(runtime);
    const jobs = createLiveJobReplica(gitContract.checkout.pull, git.checkout.pull);

    try {
      const lease = await jobs.start({ checkoutPath: '/repo' });
      const handle = await lease.ready();
      await expect(handle.result).rejects.toBeTruthy();
      await lease.release();
    } finally {
      await jobs.dispose();
      dispose();
      await runtime.dispose();
    }
  });
});
