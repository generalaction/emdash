import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { createBoundExec } from '../../exec';
import { KeyedMutex } from '../../lib';
import { WatchService } from '../../watch';
import type { WorktreeWatchEffects } from '../watch/classifier';
import { GitRepository } from './git-repository';

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

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout;
}

async function makeRepo(): Promise<string> {
  const repo = await mkdtemp(path.join(tmpdir(), 'emdash-git-repository-'));
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'test@example.com']);
  await git(repo, ['config', 'user.name', 'Test User']);
  await writeFile(path.join(repo, 'tracked.txt'), 'before\n', 'utf8');
  await git(repo, ['add', 'tracked.txt']);
  await git(repo, ['commit', '-m', 'init']);
  return await realpath(repo);
}

async function makeRepository() {
  const repo = await makeRepo();
  const watcher = new WatchService();
  const gitCommonDir = path.join(repo, '.git');
  const repository = await GitRepository.create({
    gitCommonDir,
    objectStoreDir: gitCommonDir,
    exec: createBoundExec({ file: 'git', cwd: repo }),
    watcher,
    objectStoreMutex: new KeyedMutex(),
  });
  const cleanup = async () => {
    await repository.dispose();
    await watcher.dispose();
    await rm(repo, { recursive: true, force: true });
  };
  return { repo, repository, cleanup };
}

describe('GitRepository', () => {
  it('seeds refs/remotes/stashes and refreshes refs synchronously on branch mutations', async () => {
    const { repository, cleanup } = await makeRepository();
    try {
      const initialRefs = repository.refs.snapshot().data;
      expect(initialRefs.branches).toEqual([
        expect.objectContaining({ type: 'local', branch: 'main' }),
      ]);
      expect(initialRefs.tags).toEqual([]);
      expect(repository.remotes.snapshot().data).toEqual({ remotes: [] });
      expect(repository.stashes.snapshot().data).toEqual({ stashes: [] });

      let refsUpdates = 0;
      const unsubscribe = repository.refs.subscribe(() => {
        refsUpdates += 1;
      });

      const createResult = await repository.createBranch({ name: 'feature' });
      expect(createResult.success).toBe(true);
      expect(repository.refs.snapshot().data.branches).toContainEqual(
        expect.objectContaining({ type: 'local', branch: 'feature' })
      );
      expect(refsUpdates).toBeGreaterThan(0);

      const renameResult = await repository.renameBranch('feature', 'renamed');
      expect(renameResult.success).toBe(true);
      const branches = repository.refs.snapshot().data.branches.map((branch) => branch.branch);
      expect(branches).toContain('renamed');
      expect(branches).not.toContain('feature');

      const deleteResult = await repository.deleteBranch('renamed', true);
      expect(deleteResult.success).toBe(true);
      expect(repository.refs.snapshot().data.branches.map((branch) => branch.branch)).toEqual([
        'main',
      ]);

      unsubscribe();
    } finally {
      await cleanup();
    }
  });

  it('classifies delete failures for the current branch', async () => {
    const { repository, cleanup } = await makeRepository();
    try {
      const result = await repository.deleteBranch('main');
      expect(result.success).toBe(false);
      if (result.success) throw new Error('expected failure');
      expect(result.error.type).toBe('is_current');
    } finally {
      await cleanup();
    }
  });

  it('models tags including annotated tag messages', async () => {
    const { repository, cleanup } = await makeRepository();
    try {
      const lightweight = await repository.createTag({ name: 'v1' });
      expect(lightweight.success).toBe(true);
      const annotated = await repository.createTag({ name: 'v2', message: 'release two' });
      expect(annotated.success).toBe(true);

      const tags = repository.refs.snapshot().data.tags;
      expect(tags).toEqual([
        expect.objectContaining({ name: 'v1' }),
        expect.objectContaining({ name: 'v2', message: 'release two' }),
      ]);
      // Annotated tag oid is peeled to the commit it points at.
      expect(tags[1]!.oid).toBe(tags[0]!.oid);

      const deleted = await repository.deleteTag('v1');
      expect(deleted.success).toBe(true);
      expect(repository.refs.snapshot().data.tags).toEqual([
        expect.objectContaining({ name: 'v2' }),
      ]);
    } finally {
      await cleanup();
    }
  });

  it('manages remotes and refreshes the remotes model synchronously', async () => {
    const { repository, cleanup } = await makeRepository();
    try {
      const added = await repository.addRemote('origin', 'https://example.com/repo.git');
      expect(added.success).toBe(true);
      expect(repository.remotes.snapshot().data.remotes).toEqual([
        { name: 'origin', url: 'https://example.com/repo.git' },
      ]);

      const removed = await repository.removeRemote('origin');
      expect(removed.success).toBe(true);
      expect(repository.remotes.snapshot().data.remotes).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  it('models stashes created outside the class via the commonDir watch', async () => {
    const { repo, repository, cleanup } = await makeRepository();
    try {
      await writeFile(path.join(repo, 'tracked.txt'), 'dirty\n', 'utf8');
      await git(repo, ['stash', 'push', '-m', 'wip work']);

      const stash = await eventually(() => repository.stashes.snapshot().data.stashes[0]);
      expect(stash).toMatchObject({ index: 0, ref: 'stash@{0}', branch: 'main' });
      expect(stash.message).toContain('wip work');

      const dropped = await repository.stashDrop(0);
      expect(dropped.success).toBe(true);
      expect(repository.stashes.snapshot().data.stashes).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  it('lists, adds, and removes checkouts', async () => {
    const { repo, repository, cleanup } = await makeRepository();
    try {
      const initial = await repository.listCheckouts();
      expect(initial).toEqual([
        expect.objectContaining({
          checkoutPath: repo,
          isMain: true,
          head: expect.objectContaining({ kind: 'branch', name: 'main' }),
          branch: 'main',
        }),
      ]);

      const linkedPath = path.join(path.dirname(repo), `${path.basename(repo)}-linked`);
      const added = await repository.addCheckout({ path: linkedPath, newBranch: 'linked' });
      expect(added.success).toBe(true);
      if (!added.success) throw new Error('addCheckout failed');
      expect(added.data).toMatchObject({ isMain: false, branch: 'linked' });
      expect(repository.refs.snapshot().data.branches).toContainEqual(
        expect.objectContaining({ type: 'local', branch: 'linked' })
      );

      const removed = await repository.removeCheckout(added.data.checkoutPath);
      expect(removed.success).toBe(true);
      expect(await repository.listCheckouts()).toHaveLength(1);

      await rm(linkedPath, { recursive: true, force: true });
    } finally {
      await cleanup();
    }
  });

  it('routes classified checkout effects to registered checkouts', async () => {
    const { repo, repository, cleanup } = await makeRepository();
    try {
      const effects: WorktreeWatchEffects[] = [];
      const unregister = repository.registerCheckout(repo, {
        gitDir: repository.gitCommonDir,
        worktree: repo,
        onEffects: (effect) => effects.push(effect),
      });

      await writeFile(path.join(repo, 'tracked.txt'), 'changed\n', 'utf8');
      await git(repo, ['add', 'tracked.txt']);
      await eventually(() => (effects.some((effect) => effect.status) ? true : undefined));

      unregister();
    } finally {
      await cleanup();
    }
  });

  it('reads blobs at refs and falls back to null for unknown paths', async () => {
    const { repository, cleanup } = await makeRepository();
    try {
      await expect(repository.readBlobAtRef('HEAD', 'tracked.txt')).resolves.toBe('before\n');
      await expect(repository.readBlobAtRef('HEAD', 'missing.txt')).resolves.toBeNull();
    } finally {
      await cleanup();
    }
  });

  it('resolves the default branch from local fallbacks without a remote', async () => {
    const { repository, cleanup } = await makeRepository();
    try {
      await expect(repository.getDefaultBranch()).resolves.toBe('main');
    } finally {
      await cleanup();
    }
  });

  it('onCheckoutMutation refreshes the targeted model immediately', async () => {
    const { repo, repository, cleanup } = await makeRepository();
    try {
      // Mutate refs behind the class's back, then ask for a sync refresh.
      await git(repo, ['branch', 'behind-the-back']);
      await repository.onCheckoutMutation('refs');
      expect(repository.refs.snapshot().data.branches).toContainEqual(
        expect.objectContaining({ branch: 'behind-the-back' })
      );
    } finally {
      await cleanup();
    }
  });
});
