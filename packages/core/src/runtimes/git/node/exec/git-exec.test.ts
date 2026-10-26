import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BoundExec } from '#services/exec/api';
import { bindGitDir, createGitExec } from './git-exec';

describe('createGitExec', () => {
  it('runs git non-interactively without displacing core.sshCommand', async () => {
    const home = mkdtempSync(join(tmpdir(), 'emdash-git-home-'));
    const exec = createGitExec({
      cwd: process.cwd(),
      executable: process.execPath,
      env: { HOME: home, LC_ALL: 'de_DE.UTF-8' },
    });

    const { stdout } = await exec.exec(['-p', 'JSON.stringify(process.env)']).finally(() => {
      rmSync(home, { recursive: true, force: true });
    });
    const env = JSON.parse(stdout) as NodeJS.ProcessEnv;

    expect(env).toMatchObject({
      LC_ALL: 'C',
      GIT_TERMINAL_PROMPT: '0',
      GIT_SSH: expect.stringMatching(/ssh$/),
    });
    // GIT_SSH_COMMAND would outrank core.sshCommand; GIT_SSH ranks below it.
    expect(env).not.toHaveProperty('GIT_SSH_COMMAND');
  });

  it('loads the current environment for every git subprocess', async () => {
    let env = { EMDASH_ENV_REVISION: 'before-refresh' };
    const exec = createGitExec({
      cwd: process.cwd(),
      executable: process.execPath,
      env: async () => env,
    });

    const before = await exec.exec(['-p', 'process.env.EMDASH_ENV_REVISION']);
    env = { EMDASH_ENV_REVISION: 'after-refresh' };
    const after = await exec.exec(['-p', 'process.env.EMDASH_ENV_REVISION']);

    expect(before.stdout.trim()).toBe('before-refresh');
    expect(after.stdout.trim()).toBe('after-refresh');
  });
});

describe('bindGitDir', () => {
  it('binds every execution mode to one Git directory', async () => {
    const calls: string[][] = [];
    const makeExec = (cwd: string): BoundExec => ({
      file: 'git',
      cwd,
      async exec(args) {
        calls.push(args);
        return { stdout: '', stderr: '' };
      },
      async execStreaming(args) {
        calls.push(args);
      },
      async execBuffer(args) {
        calls.push(args);
        return { stdout: Buffer.alloc(0), stderr: '' };
      },
      spawn(args) {
        calls.push(args);
        return {} as never;
      },
      withCwd: makeExec,
    });
    const exec = bindGitDir(makeExec('/runtime'), '/repo/.git');

    await exec.exec(['status']);
    await exec.execStreaming(['fetch'], () => {});
    await exec.execBuffer(['cat-file', 'blob', 'HEAD:file']);
    await exec.spawn(['cat-file', '--batch']);
    const moved = exec.withCwd('/other');
    await moved.exec(['branch']);

    expect(calls).toEqual([
      ['--git-dir=/repo/.git', 'status'],
      ['--git-dir=/repo/.git', 'fetch'],
      ['--git-dir=/repo/.git', 'cat-file', 'blob', 'HEAD:file'],
      ['--git-dir=/repo/.git', 'cat-file', '--batch'],
      ['--git-dir=/repo/.git', 'branch'],
    ]);
    expect(moved.cwd).toBe('/other');
  });
});
