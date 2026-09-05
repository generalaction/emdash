import { describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '#primitives/exec/api';
import {
  decodeTmuxSessionName,
  listTmuxSessionActivity,
  makeTmuxSessionName,
  parseTmuxSessionActivity,
  TMUX_SESSION_PREFIX,
} from './tmux';

describe('tmux session names', () => {
  const uuidSessionId =
    '5ecb5f07-2f59-4c17-a3a2-bfc21eefa2d5:9d0f68e1-15e6-4a8b-98a7-d4e3f0c2b1aa:0f3be1c2-77d8-4b5f-a111-2ce4f5a6b9d0';

  it('keeps UUID-backed session names short and decodable', () => {
    const name = makeTmuxSessionName(uuidSessionId);

    expect(name.startsWith(TMUX_SESSION_PREFIX)).toBe(true);
    // The previous encoding base64url-ed the full 110-character id text (~154 chars).
    expect(name.length).toBeLessThan(80);
    expect(decodeTmuxSessionName(name)).toBe(uuidSessionId);
  });

  it('round-trips non-UUID session ids through the legacy encoding', () => {
    const sessionId = 'project:task:leaf';

    expect(decodeTmuxSessionName(makeTmuxSessionName(sessionId))).toBe(sessionId);
  });

  it('still decodes long names created by older builds', () => {
    const legacy = TMUX_SESSION_PREFIX + Buffer.from(uuidSessionId, 'utf8').toString('base64url');

    expect(legacy.length).toBeGreaterThan(100);
    expect(decodeTmuxSessionName(legacy)).toBe(uuidSessionId);
  });

  it('rejects names that are not emdash session encodings', () => {
    expect(decodeTmuxSessionName('someone-elses-session')).toBeNull();
    expect(decodeTmuxSessionName(TMUX_SESSION_PREFIX)).toBeNull();
    expect(decodeTmuxSessionName(`${TMUX_SESSION_PREFIX}not base64!`)).toBeNull();
  });
});

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
