import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BoundExec } from '#services/exec/api';
import { copyPreservedFiles } from './copy-preserved-files';

describe('copyPreservedFiles', () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  it('copies an untracked regular file', async () => {
    const fixture = await createFixture();
    await writeFile(path.join(fixture.repoPath, '.env.local'), 'TOKEN=test');

    expect(
      await copyPreservedFiles({
        ...fixture,
        patterns: ['.env.local'],
        git: untrackedGit(),
      })
    ).toEqual([]);
    await expect(readFile(path.join(fixture.worktreePath, '.env.local'), 'utf8')).resolves.toBe(
      'TOKEN=test'
    );
  });

  it('leaves an existing regular destination unchanged on retry', async () => {
    const fixture = await createFixture();
    await writeFile(path.join(fixture.repoPath, '.env.local'), 'TOKEN=new');
    await writeFile(path.join(fixture.worktreePath, '.env.local'), 'TOKEN=existing');

    expect(
      await copyPreservedFiles({
        ...fixture,
        patterns: ['.env.local'],
        git: untrackedGit(),
      })
    ).toEqual([]);
    await expect(readFile(path.join(fixture.worktreePath, '.env.local'), 'utf8')).resolves.toBe(
      'TOKEN=existing'
    );
  });

  it('does not follow symlinked source ancestors outside the repository', async () => {
    const fixture = await createFixture();
    const outsidePath = path.join(root!, 'outside');
    await mkdir(outsidePath);
    await writeFile(path.join(outsidePath, 'secret.txt'), 'secret');
    await symlink(outsidePath, path.join(fixture.repoPath, 'linked'));

    const warnings = await copyPreservedFiles({
      ...fixture,
      patterns: ['linked/secret.txt'],
      git: untrackedGit(),
    });

    expect(warnings).toEqual(['Skipped symlinked preserve source "linked/secret.txt"']);
    await expect(readFile(path.join(fixture.worktreePath, 'linked/secret.txt'))).rejects.toThrow();
  });

  it('does not create files or directories through a symlinked destination ancestor', async () => {
    const fixture = await createFixture();
    const sourceDirectory = path.join(fixture.repoPath, 'linked');
    const outsidePath = path.join(root!, 'outside');
    await Promise.all([mkdir(sourceDirectory), mkdir(outsidePath)]);
    await writeFile(path.join(sourceDirectory, 'secret.txt'), 'secret');
    await symlink(outsidePath, path.join(fixture.worktreePath, 'linked'));

    const warnings = await copyPreservedFiles({
      ...fixture,
      patterns: ['linked/secret.txt'],
      git: untrackedGit(),
    });

    expect(warnings).toEqual(['Skipped symlinked preserve destination "linked/secret.txt"']);
    await expect(readFile(path.join(outsidePath, 'secret.txt'))).rejects.toThrow();
  });

  it('never copies the Emdash configuration file', async () => {
    const fixture = await createFixture();
    await writeFile(path.join(fixture.repoPath, '.emdash.json'), '{"scripts":{"setup":"unsafe"}}');

    expect(
      await copyPreservedFiles({
        ...fixture,
        patterns: ['**'],
        git: untrackedGit(),
      })
    ).toEqual([]);
    await expect(readFile(path.join(fixture.worktreePath, '.emdash.json'))).rejects.toThrow();
  });

  it('propagates cancellation without leaving a partial target or staging file', async () => {
    const fixture = await createFixture();
    await writeFile(path.join(fixture.repoPath, '.env.local'), 'TOKEN=test');
    const controller = new AbortController();
    controller.abort();

    await expect(
      copyPreservedFiles({
        ...fixture,
        patterns: ['.env.local'],
        git: untrackedGit(),
        signal: controller.signal,
      })
    ).rejects.toThrow();
    expect(await readdir(fixture.worktreePath)).toEqual([]);
  });

  it('cleans stale staging files left beside the worktree by an interrupted run', async () => {
    const fixture = await createFixture();
    const stalePath = path.join(root!, '.worktree.emdash-preserve-stale.tmp');
    await writeFile(stalePath, 'TOKEN=stale', { mode: 0o600 });

    await copyPreservedFiles({ ...fixture, patterns: [], git: untrackedGit() });

    await expect(readFile(stalePath)).rejects.toThrow();
  });

  async function createFixture(): Promise<{ repoPath: string; worktreePath: string }> {
    root = await mkdtemp(path.join(tmpdir(), 'copy-preserved-files-'));
    const repoPath = path.join(root, 'repo');
    const worktreePath = path.join(root, 'worktree');
    await Promise.all([mkdir(repoPath), mkdir(worktreePath)]);
    return { repoPath, worktreePath };
  }
});

function untrackedGit(): BoundExec {
  return {
    file: 'git',
    cwd: '/',
    exec: vi.fn().mockRejectedValue(new Error('not tracked')),
    execStreaming: vi.fn(),
    execBuffer: vi.fn(),
    spawn: vi.fn(),
    withCwd: vi.fn(),
  };
}
