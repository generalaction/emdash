import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as execApi from '#services/exec/api';
import { inspectWorkspacePath } from './inspect-path';

describe('inspectWorkspacePath', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'git-inspection-')));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });

  function git(...args: string[]) {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  }

  it('distinguishes a repository root, linked worktree, and repository subdirectory', async () => {
    git('init', '--quiet');
    git(
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '--allow-empty',
      '-m',
      'initial'
    );
    const subdirectory = path.join(root, 'subdirectory');
    await fs.mkdir(subdirectory);
    const worktree = path.join(root, 'linked');
    git('worktree', 'add', '--detach', worktree);

    await expect(inspectWorkspacePath(root)).resolves.toEqual({ kind: 'repository' });
    await expect(inspectWorkspacePath(subdirectory)).resolves.toEqual({ kind: 'directory' });
    await expect(inspectWorkspacePath(worktree)).resolves.toEqual({
      kind: 'worktree',
      repositoryPath: root,
      gitAdminName: 'linked',
    });
  });

  it('recognizes a plain directory and a bare repository as directory workspaces', async () => {
    await expect(inspectWorkspacePath(root)).resolves.toEqual({ kind: 'directory' });
    git('init', '--bare', '--quiet');
    await expect(inspectWorkspacePath(root)).resolves.toEqual({ kind: 'directory' });
  });

  it('preserves the missing-executable diagnostic from the supplied host environment', async () => {
    git('init', '--quiet');
    const emptyPath = path.join(root, 'empty-path');
    await fs.mkdir(emptyPath);

    await expect(
      inspectWorkspacePath(root, async () => ({ ...process.env, PATH: emptyPath, Path: emptyPath }))
    ).resolves.toMatchObject({
      kind: 'inspect-failed',
      message: expect.stringContaining('ENOENT'),
    });
    await expect(inspectWorkspacePath(root)).resolves.toEqual({ kind: 'repository' });
  });

  it('preserves fatal configuration errors instead of reporting a directory', async () => {
    git('init', '--quiet');
    await fs.writeFile(path.join(root, '.git', 'config'), '[broken\n');

    await expect(inspectWorkspacePath(root)).resolves.toMatchObject({
      kind: 'inspect-failed',
      message: expect.stringContaining('bad config line'),
    });
  });

  it('preserves a broken gitfile as an inspection failure', async () => {
    await fs.writeFile(path.join(root, '.git'), 'gitdir: missing-git-directory\n');

    await expect(inspectWorkspacePath(root)).resolves.toMatchObject({
      kind: 'inspect-failed',
      message: expect.stringContaining('not a git repository:'),
    });
  });

  it.each([
    [127, 'git launcher: command not found'],
    [128, 'fatal: detected dubious ownership in repository'],
    [128, 'fatal: cannot access .git/config: Permission denied'],
    [null, 'Timed out after 10000ms'],
  ])('preserves command failure %s: %s', async (exitCode, stderr) => {
    const exec = execApi.createBoundExec({ file: 'git', cwd: root });
    vi.spyOn(exec, 'exec').mockRejectedValue(
      new execApi.ExecError('git', [], exitCode, '', stderr)
    );
    vi.spyOn(execApi, 'createBoundExec').mockReturnValue(exec);

    await expect(inspectWorkspacePath(root)).resolves.toEqual({
      kind: 'inspect-failed',
      message: stderr,
    });
  });

  it('does not downgrade a repository if metadata disappears after discovery', async () => {
    const exec = execApi.createBoundExec({ file: 'git', cwd: root });
    vi.spyOn(exec, 'exec')
      .mockResolvedValueOnce({ stdout: 'true\n', stderr: '' })
      .mockRejectedValueOnce(
        new execApi.ExecError(
          'git',
          [],
          128,
          '',
          'fatal: not a git repository (or any of the parent directories): .git'
        )
      );
    vi.spyOn(execApi, 'createBoundExec').mockReturnValue(exec);

    await expect(inspectWorkspacePath(root)).resolves.toMatchObject({ kind: 'inspect-failed' });
  });

  it('rejects malformed discovery output rather than classifying a directory', async () => {
    const exec = execApi.createBoundExec({ file: 'git', cwd: root });
    vi.spyOn(exec, 'exec').mockResolvedValue({ stdout: 'unexpected\n', stderr: '' });
    vi.spyOn(execApi, 'createBoundExec').mockReturnValue(exec);

    await expect(inspectWorkspacePath(root)).resolves.toMatchObject({
      kind: 'inspect-failed',
      message: expect.stringContaining('Unexpected git rev-parse output'),
    });
  });
});
