import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createBoundExec } from '@emdash/core/exec';
import { describe, expect, it } from 'vitest';
import type { RepositoryIdentity } from '../identity/types';
import { GitRepository } from './git-repository';

const execFileAsync = promisify(execFile);

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
  const gitCommonDir = await realpath(path.join(repo, '.git'));
  const objectStoreDir = await realpath(path.join(gitCommonDir, 'objects'));
  const identity = {
    repositoryId: gitCommonDir,
    objectStoreId: objectStoreDir,
    gitCommonDir,
    objectStoreDir,
  } as RepositoryIdentity;
  const repository = await GitRepository.create({
    identity,
    exec: createBoundExec({ file: 'git', cwd: repo }),
  });
  const cleanup = async () => {
    await repository.dispose();
    await rm(repo, { recursive: true, force: true });
  };
  return { repo, repository, cleanup };
}

describe('GitRepository', () => {
  it('computes refs, remotes, and stashes from git', async () => {
    const { repository, cleanup } = await makeRepository();
    try {
      await expect(repository.getRefs()).resolves.toMatchObject({
        branches: [expect.objectContaining({ type: 'local', branch: 'main' })],
        tags: [],
      });
      await expect(repository.getRemotes()).resolves.toEqual({ remotes: [] });
      await expect(repository.getStashes()).resolves.toEqual({ stashes: [] });
    } finally {
      await cleanup();
    }
  });

  it('runs branch mutations and exposes fresh refs on demand', async () => {
    const { repository, cleanup } = await makeRepository();
    try {
      await expect(
        repository.createBranch({ name: 'feature', from: 'main' })
      ).resolves.toMatchObject({
        success: true,
      });
      expect((await repository.getRefs()).branches).toContainEqual(
        expect.objectContaining({ type: 'local', branch: 'feature' })
      );

      await expect(repository.renameBranch('feature', 'renamed')).resolves.toMatchObject({
        success: true,
      });
      const branches = (await repository.getRefs()).branches.map((branch) => branch.branch);
      expect(branches).toContain('renamed');
      expect(branches).not.toContain('feature');

      await expect(repository.deleteBranch('renamed', true)).resolves.toMatchObject({
        success: true,
      });
      expect((await repository.getRefs()).branches.map((branch) => branch.branch)).toEqual([
        'main',
      ]);
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
      await expect(repository.createTag({ name: 'v1', ref: 'main' })).resolves.toMatchObject({
        success: true,
      });
      await expect(
        repository.createTag({ name: 'v2', ref: 'main', message: 'release two' })
      ).resolves.toMatchObject({ success: true });

      const tags = (await repository.getRefs()).tags;
      expect(tags).toEqual([
        expect.objectContaining({ name: 'v1' }),
        expect.objectContaining({ name: 'v2', message: 'release two' }),
      ]);
      expect(tags[1]!.oid).toBe(tags[0]!.oid);

      await expect(repository.deleteTag('v1')).resolves.toMatchObject({ success: true });
      expect((await repository.getRefs()).tags).toEqual([expect.objectContaining({ name: 'v2' })]);
    } finally {
      await cleanup();
    }
  });

  it('manages remotes and exposes fresh remotes on demand', async () => {
    const { repository, cleanup } = await makeRepository();
    try {
      await expect(
        repository.addRemote('origin', 'https://example.com/repo.git')
      ).resolves.toMatchObject({ success: true });
      expect((await repository.getRemotes()).remotes).toEqual([
        { name: 'origin', url: 'https://example.com/repo.git' },
      ]);

      await expect(repository.removeRemote('origin')).resolves.toMatchObject({ success: true });
      expect((await repository.getRemotes()).remotes).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  it('models stashes created outside the class', async () => {
    const { repo, repository, cleanup } = await makeRepository();
    try {
      await writeFile(path.join(repo, 'tracked.txt'), 'dirty\n', 'utf8');
      await git(repo, ['stash', 'push', '-m', 'wip work']);

      const stash = (await repository.getStashes()).stashes[0];
      expect(stash).toMatchObject({ index: 0, ref: 'stash@{0}', branch: 'main' });
      expect(stash?.message).toContain('wip work');

      await expect(repository.stashDrop(0)).resolves.toMatchObject({ success: true });
      expect((await repository.getStashes()).stashes).toEqual([]);
    } finally {
      await cleanup();
    }
  });

  it('lists, adds, and removes worktrees without embedding checkout OIDs', async () => {
    const { repo, repository, cleanup } = await makeRepository();
    try {
      const initial = await repository.listWorktrees();
      expect(initial).toEqual([
        expect.objectContaining({
          worktreePath: repo,
          isMain: true,
          head: expect.objectContaining({ kind: 'branch', name: 'main' }),
        }),
      ]);

      const linkedPath = path.join(path.dirname(repo), `${path.basename(repo)}-linked`);
      const added = await repository.addWorktree({
        path: linkedPath,
        ref: 'main',
        newBranch: 'linked',
      });
      expect(added.success).toBe(true);
      if (!added.success) throw new Error('addWorktree failed');
      expect(added.data).toMatchObject({
        isMain: false,
        head: { kind: 'branch', name: 'linked' },
      });
      expect(added.data.head).not.toHaveProperty('oid');
      expect((await repository.getRefs()).branches).toContainEqual(
        expect.objectContaining({ type: 'local', branch: 'linked' })
      );

      await expect(repository.removeWorktree(added.data.worktreePath)).resolves.toMatchObject({
        success: true,
      });
      expect(await repository.listWorktrees()).toHaveLength(1);

      await rm(linkedPath, { recursive: true, force: true });
    } finally {
      await cleanup();
    }
  });

  it('reads blobs at refs and falls back to null for unknown paths', async () => {
    const { repository, cleanup } = await makeRepository();
    try {
      await expect(repository.readBlobAtRef('HEAD', 'tracked.txt')).resolves.toBe('before\n');
      await expect(repository.readBlobAtRef('HEAD', 'missing.txt')).resolves.toBeNull();
      await expect(repository.readBlobAtRef('HEAD', '../secret.txt')).rejects.toThrow(
        'Invalid repository file path'
      );
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
});
