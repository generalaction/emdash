import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { FileWatchService } from '../fs';
import { GitRuntime, type GitRepoUpdate, type GitWorktreeUpdate } from './index';

const execFileAsync = promisify(execFile);

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

async function makeRepo(): Promise<string> {
  const repo = await mkdtemp(path.join(tmpdir(), 'emdash-shared-worktree-'));
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: repo });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: repo });
  await writeFile(path.join(repo, 'tracked.txt'), 'before\n', 'utf8');
  await execFileAsync('git', ['add', 'tracked.txt'], { cwd: repo });
  await execFileAsync('git', ['commit', '-m', 'init'], { cwd: repo });
  return repo;
}

async function makeRepoWithRemote(): Promise<{ repo: string; remote: string }> {
  const remote = await mkdtemp(path.join(tmpdir(), 'emdash-shared-worktree-remote-'));
  await execFileAsync('git', ['init', '--bare'], { cwd: remote });
  const repo = await makeRepo();
  await execFileAsync('git', ['remote', 'add', 'origin', remote], { cwd: repo });
  await execFileAsync('git', ['push', '-u', 'origin', 'main'], { cwd: repo });
  return { repo, remote };
}

async function makeRecordingGitExecutable(): Promise<{ executable: string; logPath: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'emdash-shared-git-bin-'));
  const executable = path.join(dir, 'git-wrapper.sh');
  const logPath = path.join(dir, 'git-calls.log');
  await writeFile(
    executable,
    ['#!/bin/sh', `printf '%s\\n' "$1" >> ${JSON.stringify(logPath)}`, 'exec git "$@"', ''].join(
      '\n'
    ),
    'utf8'
  );
  await chmod(executable, 0o755);
  return { executable, logPath };
}

describe('GitWorktree', () => {
  it('refreshes and emits worktree facts for real file and git mutations', async () => {
    const repo = await makeRepo();
    const watcher = new FileWatchService();
    const runtime = new GitRuntime({ watcher });
    const updates: GitWorktreeUpdate[] = [];
    const repoUpdates: GitRepoUpdate[] = [];

    try {
      const lease = await runtime.openWorktree(repo);
      const worktree = lease.value;
      worktree.subscribe((update) => updates.push(update));
      worktree.repository.subscribe((update) => repoUpdates.push(update));

      await expect(worktree.getHead()).resolves.toEqual({ kind: 'branch', name: 'main' });
      await expect(worktree.getSnapshot()).resolves.toMatchObject({
        status: { sequence: expect.any(Number), value: expect.objectContaining({ kind: 'ok' }) },
        head: { sequence: expect.any(Number), value: { kind: 'branch', name: 'main' } },
      });
      await expect(worktree.getStatusFingerprint('normal')).resolves.toMatchObject({
        byteLength: expect.any(Number),
        hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
      await expect(worktree.isFileCleanlyTracked('tracked.txt')).resolves.toBe(true);
      await writeFile(path.join(repo, 'tracked.txt'), 'after\n', 'utf8');

      // Wait for a pushed status model that reflects the modification (subscribe also
      // pushes an initial clean status, so matching on kind alone would race).
      await eventually(() =>
        updates.some(
          (update) =>
            update.kind === 'status' &&
            update.model.kind === 'ok' &&
            update.model.unstaged.some((change) => change.path === 'tracked.txt')
        )
          ? true
          : undefined
      );
      await expect(worktree.isFileCleanlyTracked('tracked.txt')).resolves.toBe(false);
      const changedStatus = await worktree.getStatus();
      expect(changedStatus).toMatchObject({
        kind: 'ok',
        unstaged: [expect.objectContaining({ path: 'tracked.txt', status: 'modified' })],
      });
      expect(changedStatus).not.toHaveProperty('currentBranch');
      expect(changedStatus).not.toHaveProperty('headKind');
      expect(changedStatus).not.toHaveProperty('shortHash');

      await expect(worktree.getFileAtRef('tracked.txt', 'HEAD')).resolves.toBe('before\n');
      await expect(worktree.getChangedFiles({ kind: 'head' })).resolves.toEqual([
        expect.objectContaining({ path: 'tracked.txt', status: 'modified' }),
      ]);

      const stageSequences = await worktree.stage(['tracked.txt']);
      expect(stageSequences.status).toBeGreaterThanOrEqual(1);
      const snapshotAfterStage = await worktree.getSnapshot();
      expect(snapshotAfterStage.status.sequence).toBeGreaterThanOrEqual(stageSequences.status!);
      expect(await worktree.getStatus()).toMatchObject({
        kind: 'ok',
        staged: [expect.objectContaining({ path: 'tracked.txt', status: 'modified' })],
        unstaged: [],
        stagedAdded: 1,
        stagedDeleted: 1,
      });
      expect(await worktree.getStatus()).not.toHaveProperty('totalAdded');
      expect(await worktree.getStatus()).not.toHaveProperty('totalDeleted');
      await expect(worktree.getFileAtIndex('tracked.txt')).resolves.toBe('after\n');
      await expect(worktree.getChangedFiles({ kind: 'staged' })).resolves.toEqual([
        expect.objectContaining({ path: 'tracked.txt', status: 'modified' }),
      ]);

      const commit = await worktree.commit('change tracked');
      expect(commit.success).toBe(true);
      if (!commit.success) throw new Error(commit.error.message);
      expect(commit.data.hash).toMatch(/^[0-9a-f]{40}$/);
      expect(commit.data.sequences).toMatchObject({
        status: expect.any(Number),
        head: expect.any(Number),
        refs: expect.any(Number),
      });
      await execFileAsync('git', ['tag', 'v-change', commit.data.hash], { cwd: repo });
      expect(await worktree.getStatus()).toMatchObject({
        kind: 'ok',
        staged: [],
        unstaged: [],
      });
      await expect(worktree.getLog({ maxCount: 1 })).resolves.toMatchObject({
        aheadCount: 0,
        commits: [
          expect.objectContaining({
            hash: commit.data.hash,
            isPushed: false,
            subject: 'change tracked',
            tags: ['v-change'],
          }),
        ],
      });
      await expect(worktree.getCommitFiles(commit.data.hash)).resolves.toEqual([
        expect.objectContaining({ path: 'tracked.txt', status: 'modified' }),
      ]);

      expect(updates.some((update) => update.kind === 'head')).toBe(true);
      expect(repoUpdates.some((update) => update.kind === 'refs')).toBe(true);
      lease.release();
    } finally {
      await runtime.dispose();
      await watcher.dispose();
    }
  });

  it('computes pushed log state and refreshes refs after push', async () => {
    const { repo } = await makeRepoWithRemote();
    await writeFile(path.join(repo, 'tracked.txt'), 'pushed\n', 'utf8');
    await execFileAsync('git', ['add', 'tracked.txt'], { cwd: repo });

    const watcher = new FileWatchService();
    const runtime = new GitRuntime({ watcher });
    const repoUpdates: string[] = [];

    try {
      const lease = await runtime.openWorktree(repo);
      lease.value.repository.subscribe((update) => repoUpdates.push(update.kind));
      const commit = await lease.value.commit('push me');
      expect(commit.success).toBe(true);
      if (!commit.success) throw new Error(commit.error.message);

      expect((await lease.value.repository.getRefs()).branches).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            branch: 'main',
            divergence: { ahead: 1, behind: 0 },
            type: 'local',
          }),
        ])
      );

      repoUpdates.length = 0;
      await expect(lease.value.push()).resolves.toMatchObject({ success: true });
      expect(repoUpdates).toContain('refs');
      await expect(lease.value.getLog({ maxCount: 1 })).resolves.toMatchObject({
        aheadCount: 0,
        commits: [expect.objectContaining({ hash: commit.data.hash, isPushed: true })],
      });
      expect((await lease.value.repository.getRefs()).branches).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            branch: 'main',
            type: 'local',
          }),
        ])
      );
      lease.release();
    } finally {
      await runtime.dispose();
      await watcher.dispose();
    }
  });

  it('keeps leased worktrees usable when runtime disposal is requested', async () => {
    const repo = await makeRepo();
    const runtime = new GitRuntime();
    const lease = await runtime.openWorktree(repo);

    await runtime.dispose();

    await expect(lease.value.getStatus()).resolves.toMatchObject({ kind: 'ok' });
    await expect(runtime.openWorktree(repo)).rejects.toThrow('GitRuntime disposed');
    lease.release();
  });

  it('reads image bytes from git refs as serializable data URLs', async () => {
    const repo = await makeRepo();
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
      'base64'
    );
    await writeFile(path.join(repo, 'pixel.png'), png);
    await execFileAsync('git', ['add', 'pixel.png'], { cwd: repo });
    await execFileAsync('git', ['commit', '-m', 'add pixel'], { cwd: repo });

    const watcher = new FileWatchService();
    const runtime = new GitRuntime({ watcher });
    try {
      const lease = await runtime.openWorktree(repo);
      await expect(lease.value.getImageAtRef('pixel.png', 'HEAD')).resolves.toMatchObject({
        kind: 'image',
        image: {
          mimeType: 'image/png',
          size: png.length,
          dataUrl: expect.stringContaining('data:image/png;base64,'),
        },
      });
      lease.release();
    } finally {
      await runtime.dispose();
      await watcher.dispose();
    }
  });

  it('uses the host-provided git executable for runtime and binary Git operations', async () => {
    const repo = await makeRepo();
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
      'base64'
    );
    await writeFile(path.join(repo, 'pixel.png'), png);
    await execFileAsync('git', ['add', 'pixel.png'], { cwd: repo });
    await execFileAsync('git', ['commit', '-m', 'add pixel'], { cwd: repo });
    const { executable, logPath } = await makeRecordingGitExecutable();

    const watcher = new FileWatchService();
    const runtime = new GitRuntime({ watcher, executable });
    try {
      const lease = await runtime.openWorktree(repo);
      await expect(lease.value.getFileAtRef('tracked.txt', 'HEAD')).resolves.toBe('before\n');
      await expect(lease.value.getImageAtRef('pixel.png', 'HEAD')).resolves.toMatchObject({
        kind: 'image',
      });
      lease.release();
    } finally {
      await runtime.dispose();
      await watcher.dispose();
    }

    const calls = (await readFile(logPath, 'utf8')).trim().split('\n');
    expect(calls).toEqual(expect.arrayContaining(['rev-parse', 'cat-file']));
  });

  it('models unexpected status failures instead of reporting a clean tree', async () => {
    const repo = await makeRepo();
    const runtime = new GitRuntime();

    try {
      const lease = await runtime.openWorktree(repo);
      await rm(path.join(repo, '.git'), { force: true, recursive: true });

      await expect(lease.value.getStatus()).resolves.toMatchObject({
        kind: 'error',
        message: expect.stringContaining('not a git repository'),
      });
      lease.release();
    } finally {
      await runtime.dispose();
    }
  });

  it('computes log metadata without per-commit tag or branch lookups', async () => {
    const repo = await makeRepo();
    await writeFile(path.join(repo, 'tracked.txt'), 'second\n', 'utf8');
    await execFileAsync('git', ['add', 'tracked.txt'], { cwd: repo });
    await execFileAsync('git', ['commit', '-m', 'second'], { cwd: repo });
    await execFileAsync('git', ['tag', 'v-second'], { cwd: repo });
    const { executable, logPath } = await makeRecordingGitExecutable();
    const runtime = new GitRuntime({ executable });

    try {
      const lease = await runtime.openWorktree(repo);
      await writeFile(logPath, '', 'utf8');

      await expect(lease.value.getLog({ maxCount: 2, skip: 0 })).resolves.toMatchObject({
        aheadCount: 0,
        commits: [
          expect.objectContaining({
            subject: 'second',
            tags: ['v-second'],
          }),
          expect.objectContaining({ subject: 'init' }),
        ],
      });

      const calls = (await readFile(logPath, 'utf8')).trim().split('\n').filter(Boolean);
      expect(calls).not.toContain('tag');
      expect(calls).not.toContain('branch');
      lease.release();
    } finally {
      await runtime.dispose();
    }
  });

  it('stageAll, unstageAll, and revertAll mutate the full worktree state', async () => {
    const repo = await makeRepo();
    const watcher = new FileWatchService();
    const runtime = new GitRuntime({ watcher });

    try {
      const lease = await runtime.openWorktree(repo);
      const worktree = lease.value;

      await writeFile(path.join(repo, 'tracked.txt'), 'modified\n', 'utf8');
      await writeFile(path.join(repo, 'untracked.txt'), 'new\n', 'utf8');
      await writeFile(path.join(repo, 'to-delete.txt'), 'gone\n', 'utf8');
      await execFileAsync('git', ['add', 'to-delete.txt'], { cwd: repo });
      await execFileAsync('git', ['commit', '-m', 'add to-delete'], { cwd: repo });
      await rm(path.join(repo, 'to-delete.txt'));

      const stageAllSequences = await worktree.stageAll();
      expect(stageAllSequences.status).toBeGreaterThanOrEqual(1);
      expect(await worktree.getStatus()).toMatchObject({
        kind: 'ok',
        staged: expect.arrayContaining([
          expect.objectContaining({ path: 'tracked.txt', status: 'modified' }),
          expect.objectContaining({ path: 'untracked.txt', status: 'added' }),
          expect.objectContaining({ path: 'to-delete.txt', status: 'deleted' }),
        ]),
        unstaged: [],
      });

      const unstageAllSequences = await worktree.unstageAll();
      expect(unstageAllSequences.status).toBeGreaterThanOrEqual(1);
      expect(await worktree.getStatus()).toMatchObject({
        kind: 'ok',
        staged: [],
        unstaged: expect.arrayContaining([
          expect.objectContaining({ path: 'tracked.txt', status: 'modified' }),
          expect.objectContaining({ path: 'untracked.txt', status: 'added' }),
          expect.objectContaining({ path: 'to-delete.txt', status: 'deleted' }),
        ]),
      });

      const revertAllSequences = await worktree.revertAll();
      expect(revertAllSequences.status).toBeGreaterThanOrEqual(1);
      expect(await worktree.getStatus()).toMatchObject({
        kind: 'ok',
        staged: [],
        unstaged: [],
      });
      expect(await readFile(path.join(repo, 'tracked.txt'), 'utf8')).toBe('before\n');
      expect(await readFile(path.join(repo, 'to-delete.txt'), 'utf8')).toBe('gone\n');
      await expect(readFile(path.join(repo, 'untracked.txt'), 'utf8')).rejects.toThrow();

      lease.release();
    } finally {
      await runtime.dispose();
      await watcher.dispose();
    }
  });

  it('unstageAll and revertAll tolerate unborn HEAD', async () => {
    const repo = await mkdtemp(path.join(tmpdir(), 'emdash-shared-worktree-unborn-'));
    await execFileAsync('git', ['init', '-b', 'main'], { cwd: repo });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
    await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: repo });
    await writeFile(path.join(repo, 'untracked.txt'), 'new\n', 'utf8');

    const runtime = new GitRuntime();
    try {
      const lease = await runtime.openWorktree(repo);
      await writeFile(path.join(repo, 'extra.txt'), 'bar\n', 'utf8');

      const unstageSequences = await lease.value.unstageAll();
      expect(unstageSequences.status).toBeGreaterThanOrEqual(1);

      const revertSequences = await lease.value.revertAll();
      expect(revertSequences.status).toBeGreaterThanOrEqual(1);
      await expect(readFile(path.join(repo, 'untracked.txt'), 'utf8')).rejects.toThrow();
      await expect(readFile(path.join(repo, 'extra.txt'), 'utf8')).rejects.toThrow();

      lease.release();
    } finally {
      await runtime.dispose();
    }
  });
});
