import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { RepositoryIdentity } from '#runtimes/git/node/allocation/identity';
import { bindGitDir } from '#runtimes/git/node/exec/git-exec';
import { hostPath } from '#runtimes/git/node/testing/paths';
import { createBoundExec } from '#services/exec/api';
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
  const repository = new GitRepository({
    identity,
    exec: bindGitDir(createBoundExec({ file: 'git', cwd: tmpdir() }), gitCommonDir),
  });
  const cleanup = async () => {
    await rm(repo, { recursive: true, force: true });
  };
  return { repo, repository, cleanup };
}

describe('GitRepository', () => {
  it('computes refs and remotes from git', async () => {
    const { repository, cleanup } = await makeRepository();
    try {
      await expect(repository.getRefs()).resolves.toMatchObject({
        branches: [expect.objectContaining({ type: 'local', branch: 'main' })],
        tags: [],
      });
      await expect(repository.getRemotes()).resolves.toEqual({ remotes: [] });
    } finally {
      await cleanup();
    }
  });

  it('adds remotes and exposes fresh remotes on demand', async () => {
    const { repository, cleanup } = await makeRepository();
    try {
      await expect(
        repository.addRemote('origin', 'https://example.com/repo.git')
      ).resolves.toMatchObject({ success: true });
      expect((await repository.getRemotes()).remotes).toEqual([
        { name: 'origin', url: 'https://example.com/repo.git' },
      ]);
    } finally {
      await cleanup();
    }
  });

  it('lists worktrees without embedding checkout OIDs', async () => {
    const { repo, repository, cleanup } = await makeRepository();
    try {
      const worktrees = await repository.listWorktrees();
      expect(worktrees).toEqual([
        expect.objectContaining({
          worktreePath: hostPath(repo),
          isMain: true,
          head: expect.objectContaining({ kind: 'branch', name: 'main' }),
        }),
      ]);
      expect(worktrees[0]?.head).not.toHaveProperty('oid');
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
