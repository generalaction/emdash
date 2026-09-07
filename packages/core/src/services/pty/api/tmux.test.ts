import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '#primitives/exec/api';
// oxlint-disable-next-line emdash/core-module-boundaries -- regression exercises the real execution-error adapter behind IExecutionContext; production PTY code imports only the primitive
import { createBoundExec } from '#services/exec/api/bound-exec';
// oxlint-disable-next-line emdash/core-module-boundaries -- tests distinguish wrapped execution errors from raw execFile errors at the same primitive boundary
import { ExecError } from '#services/exec/api/types';
import { listTmuxSessionActivity, parseTmuxSessionActivity } from './tmux';

describe('parseTmuxSessionActivity', () => {
  it('parses session activity timestamps as milliseconds', () => {
    const parsed = parseTmuxSessionActivity('one\t1710000000\ntwo\t1710000005\ninvalid\n');

    expect(parsed).toEqual(
      new Map([
        ['one', 1_710_000_000_000],
        ['two', 1_710_000_005_000],
      ])
    );
  });
});

describe('listTmuxSessionActivity', () => {
  it('runs one tmux list-sessions command', async () => {
    const exec = vi.fn(async () => ({ stdout: 'name\t42\n', stderr: '' }));
    const ctx = stubExecContext(exec);

    const activity = await listTmuxSessionActivity(ctx);

    expect(exec).toHaveBeenCalledWith('tmux', [
      'list-sessions',
      '-F',
      '#{session_name}\t#{session_activity}',
    ]);
    expect(activity).toEqual(new Map([['name', 42_000]]));
  });

  it('returns an empty map when no tmux server is running', async () => {
    const exec = vi.fn(async () => {
      throw { exitCode: 1, stderr: 'no server running' };
    });

    await expect(listTmuxSessionActivity(stubExecContext(exec))).resolves.toEqual(new Map());
  });

  it('returns an empty map when no tmux server is running (execFile error shape)', async () => {
    const exec = vi.fn(async () => {
      throw Object.assign(new Error('Command failed'), { code: 1, stderr: 'no server running' });
    });

    await expect(listTmuxSessionActivity(stubExecContext(exec))).resolves.toEqual(new Map());
  });

  it('returns an empty map for the macOS missing-socket error', async () => {
    const exec = vi.fn(async () => {
      throw {
        exitCode: 1,
        stderr: 'error connecting to /private/tmp/tmux-501/default (No such file or directory)',
      };
    });

    await expect(listTmuxSessionActivity(stubExecContext(exec))).resolves.toEqual(new Map());
  });

  it('returns an empty map when tmux is not installed (spawn failure)', async () => {
    const exec = vi.fn(async () => {
      throw Object.assign(new Error('spawn tmux ENOENT'), { code: 'ENOENT' });
    });

    await expect(listTmuxSessionActivity(stubExecContext(exec))).resolves.toEqual(new Map());
  });

  it('returns an empty map when BoundExec wraps a missing tmux executable', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'emdash-tmux-missing-'));
    try {
      const bound = createBoundExec({ file: join(cwd, 'missing-tmux'), cwd });
      const ctx = stubExecContext((_file, args) => bound.exec(args ?? []));

      await expect(listTmuxSessionActivity(ctx)).resolves.toEqual(new Map());
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('returns an empty map for a shell command-not-found exit', async () => {
    const exec = vi.fn(async () => {
      throw new ExecError('tmux', [], 127, '', 'tmux: command not found');
    });

    await expect(listTmuxSessionActivity(stubExecContext(exec))).resolves.toEqual(new Map());
  });

  it.each([
    new ExecError('tmux', [], null, '', 'Timed out after 50ms'),
    new ExecError('tmux', [], null, '', 'Timed out: session not found'),
    Object.assign(new Error('spawn tmux EACCES'), { code: 'EACCES' }),
    new ExecError('tmux', [], null, '', 'spawn tmux EACCES', {
      cause: Object.assign(new Error('Permission denied'), { code: 'EACCES' }),
    }),
    Object.assign(new Error('Command failed'), { code: 2, stderr: 'configuration file not found' }),
  ])('rethrows execution failures instead of treating them as missing tmux: %s', async (error) => {
    const exec = vi.fn(async () => {
      throw error;
    });

    await expect(listTmuxSessionActivity(stubExecContext(exec))).rejects.toBe(error);
  });

  it('rethrows unexpected failures', async () => {
    const exec = vi.fn(async () => {
      throw Object.assign(new Error('Command failed'), { code: 2, stderr: 'server crashed' });
    });

    await expect(listTmuxSessionActivity(stubExecContext(exec))).rejects.toThrow('Command failed');
  });
});

function stubExecContext(exec: IExecutionContext['exec']): IExecutionContext {
  return {
    root: undefined,
    supportsLocalSpawn: false,
    exec,
    async execStreaming() {
      return { exitCode: 0 };
    },
    dispose() {},
  };
}
