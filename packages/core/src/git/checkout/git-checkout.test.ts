import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { createBoundExec } from '../../exec';
import { GitCheckout } from './git-checkout';
import type { CheckoutStatusModel } from './models/status';
import type { CheckoutRepository } from './types';

const execFileAsync = promisify(execFile);

async function makeRepo(): Promise<string> {
  const repo = await mkdtemp(path.join(tmpdir(), 'emdash-git-checkout-'));
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: repo });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: repo });
  await writeFile(path.join(repo, 'tracked.txt'), 'before\n', 'utf8');
  await execFileAsync('git', ['add', 'tracked.txt'], { cwd: repo });
  await execFileAsync('git', ['commit', '-m', 'init'], { cwd: repo });
  return realpath(repo);
}

class TestRepository implements CheckoutRepository {
  readonly gitCommonDir: string;

  constructor(
    repoPath: string,
    private readonly exec = createBoundExec({ file: 'git', cwd: repoPath })
  ) {
    this.gitCommonDir = path.join(repoPath, '.git');
  }

  async readBlobAtRef(ref: string, filePath: string): Promise<string | null> {
    try {
      const { stdout } = await this.exec.exec(['show', `${ref}:${filePath}`]);
      return stdout;
    } catch {
      return null;
    }
  }
}

async function makeCheckout() {
  const repo = await makeRepo();
  const checkout = await GitCheckout.create({
    checkoutPath: repo,
    gitDir: path.join(repo, '.git'),
    repository: new TestRepository(repo),
    exec: createBoundExec({ file: 'git', cwd: repo }),
  });
  const cleanup = async () => {
    await checkout.dispose();
    await rm(repo, { recursive: true, force: true });
  };
  return { repo, checkout, cleanup };
}

function okStatus(model: CheckoutStatusModel): Extract<CheckoutStatusModel, { kind: 'ok' }> {
  expect(model.kind).toBe('ok');
  if (model.kind !== 'ok') throw new Error(`expected ok status, got ${model.kind}`);
  return model;
}

describe('GitCheckout', () => {
  it('reads status and head and tracks the staging lifecycle', async () => {
    const { repo, checkout, cleanup } = await makeCheckout();
    try {
      const initialStatus = okStatus(await checkout.getStatus());
      expect(initialStatus.entries).toEqual({});
      expect(initialStatus.operation).toBe('none');
      expect(await checkout.getHead()).toMatchObject({ kind: 'branch', name: 'main' });

      const trackedPath = path.join(repo, 'tracked.txt');
      await writeFile(trackedPath, 'after\n', 'utf8');
      const dirty = okStatus(await checkout.getStatus());
      expect(dirty.entries[trackedPath]?.worktree).toBe('modified');

      const stageResult = await checkout.stage(['tracked.txt']);
      expect(stageResult.success).toBe(true);
      const staged = okStatus(await checkout.getStatus());
      expect(staged.entries[trackedPath]).toMatchObject({
        index: 'modified',
        worktree: 'unmodified',
      });
      expect(staged.summary).toMatchObject({ staged: 1, unstaged: 0 });

      const previousHead = await checkout.getHead();
      const previousOid = previousHead.kind === 'branch' ? previousHead.oid : '';
      const commitResult = await checkout.commit('update tracked');
      expect(commitResult.success).toBe(true);
      if (!commitResult.success) throw new Error('commit failed');
      expect(commitResult.data.hash).toMatch(/^[0-9a-f]{40}$/);

      const afterCommit = okStatus(await checkout.getStatus());
      expect(afterCommit.entries).toEqual({});
      expect(await checkout.getHead()).toMatchObject({
        kind: 'branch',
        name: 'main',
        oid: commitResult.data.hash,
      });
      expect(commitResult.data.hash).not.toBe(previousOid);
    } finally {
      await cleanup();
    }
  });

  it('models untracked files and conflict-free summaries', async () => {
    const { repo, checkout, cleanup } = await makeCheckout();
    try {
      await writeFile(path.join(repo, 'fresh.txt'), 'hello\n', 'utf8');
      const model = okStatus(await checkout.getStatus());
      expect(model.entries[path.join(repo, 'fresh.txt')]).toMatchObject({
        index: 'untracked',
        worktree: 'untracked',
        isConflicted: false,
      });
      expect(model.summary).toMatchObject({ untracked: 1, staged: 0, unstaged: 0, conflicted: 0 });
    } finally {
      await cleanup();
    }
  });

  it('produces structured file diffs for tracked and untracked files', async () => {
    const { repo, checkout, cleanup } = await makeCheckout();
    try {
      await writeFile(path.join(repo, 'tracked.txt'), 'after\n', 'utf8');
      const diffResult = await checkout.getFileDiff('tracked.txt');
      expect(diffResult.success).toBe(true);
      if (!diffResult.success) throw new Error('diff failed');
      expect(diffResult.data).toMatchObject({
        path: path.join(repo, 'tracked.txt'),
        binary: false,
        additions: 1,
        deletions: 1,
      });
      expect(diffResult.data.hunks[0]?.lines).toEqual([
        expect.objectContaining({ type: 'del', content: 'before' }),
        expect.objectContaining({ type: 'add', content: 'after' }),
      ]);

      await writeFile(path.join(repo, 'fresh.txt'), 'one\ntwo\n', 'utf8');
      const untrackedDiff = await checkout.getFileDiff('fresh.txt');
      expect(untrackedDiff.success).toBe(true);
      if (!untrackedDiff.success) throw new Error('untracked diff failed');
      expect(untrackedDiff.data).toMatchObject({ additions: 2, deletions: 0 });
    } finally {
      await cleanup();
    }
  });

  it('stages and unstages a single hunk', async () => {
    const { repo, checkout, cleanup } = await makeCheckout();
    try {
      await writeFile(path.join(repo, 'tracked.txt'), 'after\n', 'utf8');
      const diffResult = await checkout.getFileDiff('tracked.txt');
      if (!diffResult.success) throw new Error('diff failed');
      const header = diffResult.data.hunks[0]?.header;
      expect(header).toBeDefined();

      const trackedPath = path.join(repo, 'tracked.txt');
      const stageResult = await checkout.stageHunk('tracked.txt', header!);
      expect(stageResult.success).toBe(true);
      let model = okStatus(await checkout.getStatus());
      expect(model.entries[trackedPath]?.index).toBe('modified');

      const unstageResult = await checkout.unstageHunk('tracked.txt', header!);
      expect(unstageResult.success).toBe(true);
      model = okStatus(await checkout.getStatus());
      expect(model.entries[trackedPath]).toMatchObject({
        index: 'unmodified',
        worktree: 'modified',
      });
    } finally {
      await cleanup();
    }
  });

  it('reads log, single commits, commit files, and blame', async () => {
    const { repo, checkout, cleanup } = await makeCheckout();
    try {
      await writeFile(path.join(repo, 'tracked.txt'), 'after\n', 'utf8');
      await checkout.stageAll();
      const commitResult = await checkout.commit('second commit');
      if (!commitResult.success) throw new Error('commit failed');

      const log = await checkout.getLog();
      expect(log.commits).toHaveLength(2);
      expect(log.commits[0]).toMatchObject({ subject: 'second commit', isPushed: false });

      const commit = await checkout.getCommit(commitResult.data.hash);
      expect(commit).toMatchObject({ hash: commitResult.data.hash, subject: 'second commit' });
      await expect(checkout.getCommit('0'.repeat(40))).resolves.toBeNull();

      const files = await checkout.getCommitFiles(commitResult.data.hash);
      expect(files).toEqual([
        expect.objectContaining({
          path: path.join(repo, 'tracked.txt'),
          additions: 1,
          deletions: 1,
        }),
      ]);

      const blameResult = await checkout.blame('tracked.txt');
      expect(blameResult.success).toBe(true);
      if (!blameResult.success) throw new Error('blame failed');
      expect(blameResult.data.hunks).toEqual([
        expect.objectContaining({
          oid: commitResult.data.hash,
          author: 'Test User',
          authorEmail: 'test@example.com',
          summary: 'second commit',
          startLine: 1,
          lineCount: 1,
        }),
      ]);
    } finally {
      await cleanup();
    }
  });

  it('reverts working-tree changes and cleans untracked files', async () => {
    const { repo, checkout, cleanup } = await makeCheckout();
    try {
      await writeFile(path.join(repo, 'tracked.txt'), 'dirty\n', 'utf8');
      await writeFile(path.join(repo, 'junk.txt'), 'junk\n', 'utf8');
      const revertResult = await checkout.revertAll();
      expect(revertResult.success).toBe(true);
      const model = okStatus(await checkout.getStatus());
      expect(model.entries).toEqual({});
    } finally {
      await cleanup();
    }
  });
});
