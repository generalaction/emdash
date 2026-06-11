import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { FileWatchService } from '../fs';
import { GitRuntime, type GitRepoUpdate } from './index';

const execFileAsync = promisify(execFile);

async function makeRepoWithRemote(): Promise<{ repo: string; remote: string }> {
  const remote = await mkdtemp(path.join(tmpdir(), 'emdash-shared-remote-'));
  await execFileAsync('git', ['init', '--bare'], { cwd: remote });

  const repo = await mkdtemp(path.join(tmpdir(), 'emdash-shared-repo-'));
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: repo });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: repo });
  await writeFile(path.join(repo, 'a.txt'), 'hello\n', 'utf8');
  await execFileAsync('git', ['add', 'a.txt'], { cwd: repo });
  await execFileAsync('git', ['commit', '-m', 'init'], { cwd: repo });
  await execFileAsync('git', ['remote', 'add', 'origin', remote], { cwd: repo });
  await execFileAsync('git', ['push', '-u', 'origin', 'main'], { cwd: repo });
  return { repo, remote };
}

async function pushRemoteBranch(remote: string): Promise<void> {
  const clone = await mkdtemp(path.join(tmpdir(), 'emdash-shared-remote-work-'));
  await execFileAsync('git', ['clone', remote, clone]);
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: clone });
  await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: clone });
  await execFileAsync('git', ['checkout', '-b', 'remote-feature'], { cwd: clone });
  await writeFile(path.join(clone, 'remote.txt'), 'remote\n', 'utf8');
  await execFileAsync('git', ['add', 'remote.txt'], { cwd: clone });
  await execFileAsync('git', ['commit', '-m', 'remote branch'], { cwd: clone });
  await execFileAsync('git', ['push', 'origin', 'remote-feature'], { cwd: clone });
}

async function exposeRemoteBranchAsPullRef(remote: string, prNumber: number): Promise<void> {
  await pushRemoteBranch(remote);
  await execFileAsync(
    'git',
    ['update-ref', `refs/pull/${prNumber}/head`, 'refs/heads/remote-feature'],
    { cwd: remote }
  );
}

async function eventually<T>(
  read: () => T | undefined,
  timeoutMs = 5_000,
  intervalMs = 50
): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Timed out waiting for condition');
}

describe('GitRepository', () => {
  it('reads repository facts and emits updates after real git mutations', async () => {
    const { repo, remote } = await makeRepoWithRemote();
    const watcher = new FileWatchService();
    const runtime = new GitRuntime({ watcher });
    const updates: GitRepoUpdate[] = [];

    try {
      const lease = await runtime.openRepository(repo);
      const repository = lease.value;
      repository.subscribe((update) => updates.push(update));

      await expect(repository.getRemotes()).resolves.toEqual({
        remotes: [{ name: 'origin', url: remote }],
      });
      await expect(repository.getSnapshot()).resolves.toMatchObject({
        refs: {
          seq: expect.any(Number),
          value: expect.objectContaining({ branches: expect.any(Array) }),
        },
        remotes: { seq: expect.any(Number), value: { remotes: [{ name: 'origin', url: remote }] } },
      });
      const subscribed = await repository.subscribeWithSnapshot((update) => updates.push(update));
      expect(subscribed.snapshot).toMatchObject({
        refs: { value: expect.objectContaining({ branches: expect.any(Array) }) },
        remotes: { value: { remotes: [{ name: 'origin', url: remote }] } },
      });
      await expect(repository.readBlobAtRef('HEAD', 'a.txt')).resolves.toBe('hello\n');

      expect(await repository.getRefs()).toMatchObject({
        branches: expect.arrayContaining([
          expect.objectContaining({ type: 'local', branch: 'main' }),
          expect.objectContaining({
            type: 'remote',
            branch: 'main',
            remote: { name: 'origin', url: remote },
          }),
        ]),
      });

      const created = await repository.createBranch('feature', 'main');
      expect(created).toMatchObject({
        success: true,
        data: { seqs: { refs: expect.any(Number) } },
      });
      const snapshotAfterBranch = await repository.getSnapshot();
      expect(snapshotAfterBranch.refs.seq).toBeGreaterThanOrEqual(1);
      expect((await repository.getRefs()).branches).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'local', branch: 'feature' })])
      );
      expect(updates.some((update) => update.kind === 'refs')).toBe(true);

      await pushRemoteBranch(remote);
      await expect(repository.fetch('origin')).resolves.toMatchObject({ success: true });
      expect((await repository.getRefs()).branches).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'remote',
            branch: 'remote-feature',
            remote: { name: 'origin', url: remote },
          }),
        ])
      );
      expect(updates.some((update) => update.kind === 'refs')).toBe(true);
      subscribed.unsubscribe();

      lease.release();
    } finally {
      await runtime.dispose();
      await watcher.dispose();
    }
  });

  it('emits refs updates for external git mutations under the common dir', async () => {
    const { repo } = await makeRepoWithRemote();
    const watcher = new FileWatchService();
    const runtime = new GitRuntime({ watcher });
    const updates: GitRepoUpdate[] = [];

    try {
      const lease = await runtime.openRepository(repo);
      lease.value.subscribe((update) => updates.push(update));

      await execFileAsync('git', ['branch', 'external-change'], { cwd: repo });

      // Subscribe pushes an initial refs model too, so wait for one containing the branch.
      await eventually(() =>
        updates.some(
          (update) =>
            update.kind === 'refs' &&
            update.model.branches.some(
              (branch) => branch.type === 'local' && branch.branch === 'external-change'
            )
        )
          ? true
          : undefined
      );
      expect((await lease.value.getRefs()).branches).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'local', branch: 'external-change' }),
        ])
      );
      lease.release();
    } finally {
      await runtime.dispose();
      await watcher.dispose();
    }
  });

  it('resolves the default branch and creates branches from refreshed remote refs', async () => {
    const { repo, remote } = await makeRepoWithRemote();
    await pushRemoteBranch(remote);
    const runtime = new GitRuntime();

    try {
      const lease = await runtime.openRepository(repo);
      const repository = lease.value;

      await expect(repository.getDefaultBranch('origin')).resolves.toBe('main');
      await expect(
        repository.createBranch({
          name: 'from-remote',
          from: 'remote-feature',
          remote: 'origin',
          syncWithRemote: true,
        })
      ).resolves.toMatchObject({ success: true });
      expect((await repository.getRefs()).branches).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'local', branch: 'from-remote' })])
      );
      lease.release();
    } finally {
      await runtime.dispose();
    }
  });

  it('publishes a branch and refreshes remote refs', async () => {
    const { repo, remote } = await makeRepoWithRemote();
    await execFileAsync('git', ['checkout', '-b', 'publish-me'], { cwd: repo });
    await writeFile(path.join(repo, 'published.txt'), 'published\n', 'utf8');
    await execFileAsync('git', ['add', 'published.txt'], { cwd: repo });
    await execFileAsync('git', ['commit', '-m', 'publish me'], { cwd: repo });
    const runtime = new GitRuntime();

    try {
      const lease = await runtime.openRepository(repo);

      await expect(lease.value.publishBranch('publish-me', 'origin')).resolves.toMatchObject({
        success: true,
      });
      await expect(
        execFileAsync('git', ['rev-parse', '--verify', 'refs/heads/publish-me'], { cwd: remote })
      ).resolves.toMatchObject({ stdout: expect.stringMatching(/^[0-9a-f]{40}\n$/) });
      expect((await lease.value.getRefs()).branches).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'remote',
            branch: 'publish-me',
            remote: { name: 'origin', url: remote },
          }),
        ])
      );
      lease.release();
    } finally {
      await runtime.dispose();
    }
  });

  it('fetches a pull request head into a review branch', async () => {
    const { repo, remote } = await makeRepoWithRemote();
    await exposeRemoteBranchAsPullRef(remote, 7);
    const runtime = new GitRuntime();

    try {
      const lease = await runtime.openRepository(repo);

      await expect(
        lease.value.fetchPrForReview({
          prNumber: 7,
          headRefName: 'remote-feature',
          headRepositoryUrl: remote,
          localBranch: 'pr-7',
          isFork: false,
          configuredRemote: 'origin',
        })
      ).resolves.toMatchObject({ success: true });
      expect((await lease.value.getRefs()).branches).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'local', branch: 'pr-7' })])
      );
      lease.release();
    } finally {
      await runtime.dispose();
    }
  });
});
