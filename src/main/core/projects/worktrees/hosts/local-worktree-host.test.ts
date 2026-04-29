import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileSystemErrorCodes } from '@main/core/fs/types';
import { isPathInsideRoot, LocalWorktreeHost } from './local-worktree-host';

describe('LocalWorktreeHost', () => {
  let repoDir: string;
  let worktreeDir: string;
  let outsideDir: string;

  beforeEach(() => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-wtfs-repo-'));
    worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-wtfs-worktrees-'));
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-wtfs-outside-'));
  });

  afterEach(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
    fs.rmSync(worktreeDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  async function makeHost(): Promise<LocalWorktreeHost> {
    return LocalWorktreeHost.create({
      allowedRoots: [repoDir, worktreeDir],
    });
  }

  it('copies files between separate allowed roots using absolute paths', async () => {
    const host = await makeHost();
    const src = path.join(repoDir, '.env');
    const dest = path.join(worktreeDir, 'task-1', '.env');
    fs.writeFileSync(src, 'SECRET=abc');

    await host.mkdirAbsolute(path.dirname(dest), { recursive: true });
    await host.copyFileAbsolute(src, dest);

    expect(fs.readFileSync(dest, 'utf8')).toBe('SECRET=abc');
  });

  it('rejects relative paths', async () => {
    const host = await makeHost();

    await expect(host.mkdirAbsolute('relative/path', { recursive: true })).rejects.toMatchObject({
      code: FileSystemErrorCodes.INVALID_PATH,
    });
  });

  it('rejects paths outside the allowed roots', async () => {
    const host = await makeHost();
    const src = path.join(outsideDir, 'secret.txt');
    const dest = path.join(worktreeDir, 'secret.txt');
    fs.writeFileSync(src, 'outside');

    await expect(host.copyFileAbsolute(src, dest)).rejects.toMatchObject({
      code: FileSystemErrorCodes.PATH_ESCAPE,
    });
  });

  it('rejects symlink escapes outside the allowed roots', async () => {
    if (process.platform === 'win32') {
      return;
    }

    const host = await makeHost();
    const secret = path.join(outsideDir, 'passwords.txt');
    const escape = path.join(worktreeDir, 'escape');
    fs.writeFileSync(secret, 'outside');
    fs.symlinkSync(outsideDir, escape);

    await expect(host.realPathAbsolute(path.join(escape, 'passwords.txt'))).rejects.toMatchObject({
      code: FileSystemErrorCodes.PATH_ESCAPE,
    });
  });

  it('returns false/null for out-of-scope existence checks', async () => {
    const host = await makeHost();
    const outside = path.join(outsideDir, 'file.txt');
    fs.writeFileSync(outside, 'outside');

    await expect(host.existsAbsolute(outside)).resolves.toBe(false);
    await expect(host.statAbsolute(outside)).resolves.toBeNull();
  });

  it('matches Windows paths by drive-aware containment rules', () => {
    expect(
      isPathInsideRoot(String.raw`C:\repo\.env`, String.raw`C:\repo`, {
        pathApi: path.win32,
      })
    ).toBe(true);
    expect(
      isPathInsideRoot(String.raw`C:\repo2\.env`, String.raw`C:\repo`, {
        pathApi: path.win32,
      })
    ).toBe(false);
    expect(
      isPathInsideRoot(String.raw`D:\repo\.env`, String.raw`C:\repo`, {
        pathApi: path.win32,
      })
    ).toBe(false);
    expect(
      isPathInsideRoot(String.raw`c:\repo\.env`, String.raw`C:\Repo`, {
        pathApi: path.win32,
      })
    ).toBe(true);
  });
});
