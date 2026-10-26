import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '#primitives/exec/api';
// oxlint-disable-next-line emdash/core-module-boundaries -- regression exercises the real execution-error adapter behind IExecutionContext; production PTY code imports only the primitive
import { createBoundExec } from '#services/exec/api/bound-exec';
// oxlint-disable-next-line emdash/core-module-boundaries -- tests distinguish wrapped execution errors from raw execFile errors at the same primitive boundary
import { ExecError } from '#services/exec/api/types';
import {
  listTmuxSessionActivity,
  parseTmuxSessionActivity,
  resolveTmuxSession,
  tmuxIdentityActivityKey,
} from './tmux';
import { buildTmuxShellLine } from './tmux-commands';
import {
  decodeLegacyTmuxSessionName,
  makeLegacyTmuxSessionName,
  makeTmuxSessionName,
} from './tmux-identity';

const TMUX_AVAILABLE = spawnSync('tmux', ['-V']).status === 0;

describe('tmux session naming', () => {
  it('creates deterministic readable names while preserving the legacy codec', () => {
    const identity = 'project:task:terminal';
    const name = makeTmuxSessionName(identity, 'Fix login.flow: now');

    expect(name).toBe(makeTmuxSessionName(identity, 'Fix login.flow: now'));
    expect(name).not.toBe(makeTmuxSessionName('other:task:terminal', 'Fix login.flow: now'));
    expect(name).toMatch(/^fix-login-flow-now-[a-f0-9]{10}$/);
    expect(makeTmuxSessionName(identity, ':...:')).toMatch(/^session-[a-f0-9]{10}$/);

    const legacyName = makeLegacyTmuxSessionName(identity);
    expect(decodeLegacyTmuxSessionName(legacyName)).toBe(identity);
    expect(decodeLegacyTmuxSessionName(name)).toBeNull();
  });

  it('keeps the hash suffix when a long label is truncated', () => {
    const identity = 'project:task:terminal';
    const short = makeTmuxSessionName(identity, 'short');
    const long = makeTmuxSessionName(identity, 'x'.repeat(200));

    expect(long.length).toBeLessThanOrEqual(48);
    expect(long.slice(-10)).toBe(short.slice(-10));
  });

  it('keeps readable Unicode while stripping tmux separators', () => {
    expect(makeTmuxSessionName('identity', 'Über café.日本: ready')).toMatch(
      /^über-café-日本-ready-[a-f0-9]{10}$/u
    );
  });
});

describe('resolveTmuxSession', () => {
  it('prefers metadata so a renamed session remains attachable', async () => {
    const identity = 'project:task:terminal';
    const encoded = Buffer.from(JSON.stringify({ version: 1, identity }), 'utf8').toString(
      'base64url'
    );
    const exec = vi.fn(async () => ({
      stdout: `renamed\t42\tv1:${encoded}\n`,
      stderr: '',
    }));

    await expect(
      resolveTmuxSession(stubExecContext(exec), { identity, label: 'new-label' })
    ).resolves.toEqual({ name: 'renamed', exists: true, writeIdentity: true });
  });

  it('falls back to the exact legacy name without backfilling metadata', async () => {
    const identity = 'project:task:terminal';
    const legacyName = makeLegacyTmuxSessionName(identity);
    const exec = vi.fn(async () => ({
      stdout: `${legacyName}\t42\t\n${legacyName}-sibling\t43\t\n`,
      stderr: '',
    }));

    await expect(
      resolveTmuxSession(stubExecContext(exec), { identity, label: 'workspace' })
    ).resolves.toEqual({ name: legacyName, exists: true, writeIdentity: false });
  });
});

describe('buildTmuxShellLine', () => {
  it('uses exact targets and POSIX quoting', () => {
    const { shellLine } = buildTmuxShellLine(
      'workspace-$12',
      { command: '/bin/sh', args: ['-c', 'printf "$HOME"'] },
      { HOME: '/home/user' },
      'project:task:leaf'
    );

    expect(shellLine).toContain('has-session -t');
    expect(shellLine).toContain('attach-session -t');
    expect(shellLine).toContain('new-session -d -s');
    expect(shellLine).toContain('=workspace-$12');
    expect(shellLine).not.toContain('"workspace-$12"');
  });

  it('keeps environment values out of the command line', () => {
    const env = {
      EMDASH_GIT_CREDENTIAL_PORT: '45678',
      EMDASH_GIT_CREDENTIAL_NONCE: 'synthetic-nonce',
      QUOTED: 'it\'s "synthetic" $(exit 1)\nline;',
      EMPTY: '',
      LARGE_A: 'a'.repeat(40_000),
      LARGE_B: 'b'.repeat(40_000),
      TERM: 'xterm-256color',
      'NOT-A-NAME': 'synthetic-invalid',
    };
    const launch = buildTmuxShellLine('task', { command: 'agent', args: ['run'] }, env);
    const chunks = Object.keys(launch.env).filter((key) => !(key in env));

    for (const value of ['45678', 'synthetic-nonce', 'synthetic', 'a'.repeat(64)]) {
      expect(launch.shellLine).not.toContain(value);
    }
    expect(chunks).toEqual(chunks.map((_, index) => `EMDASH_TMUX_ENV_${index}`));
    expect(launch.env).toMatchObject(env);
    const transfer = chunks.map((key) => launch.env[key]).join('');
    expect(transfer).toContain('command export EMDASH_GIT_CREDENTIAL_NONCE=synthetic-nonce\n');
    expect(transfer).toContain("command export EMPTY=''\n");
    expect(transfer).not.toContain('TERM=');
    expect(transfer).not.toContain('NOT-A-NAME');
    expect(transfer.endsWith('EMDASH_TMUX_ENV_END=1\n')).toBe(true);
  });

  it('splits the transfer to fit each environment string within the Linux limit', () => {
    // Each value fits a direct spawn, but quoting and newline escapes inflate it, and an odd
    // offset puts a fixed-size boundary inside a surrogate pair.
    const env = {
      EMOJIS: '\u{1F600}'.repeat(20_000),
      QUOTES: "'".repeat(40_000),
      LINES: '\n'.repeat(10_000),
    };
    const launch = buildTmuxShellLine('task', { command: 'agent', args: ['run'] }, env);
    const chunks = Object.keys(launch.env).filter((key) => !(key in env));

    for (const key of chunks) {
      const chunk = launch.env[key]!;
      // MAX_ARG_STRLEN counts NAME=value and its terminating NUL.
      expect(Buffer.byteLength(`${key}=${chunk}`) + 1).toBeLessThanOrEqual(131_072);
      expect(Buffer.from(chunk).toString()).toBe(chunk);
    }
    const transfer = chunks.map((key) => launch.env[key]).join('');
    expect(transfer).toContain(`command export EMOJIS='${env.EMOJIS}'\n`);
    expect(transfer).toContain(`command export QUOTES='${"'\\''".repeat(40_000)}'\n`);
  });

  it.skipIf(!TMUX_AVAILABLE)(
    'creates metadata-backed sessions and reattaches legacy sessions without replacing them',
    async () => {
      const cwd = await mkdtemp('/tmp/emdash-tmux-');
      // Without TMUX, TMUX_TMPDIR selects a private server even when run inside tmux.
      const env = Object.fromEntries(
        Object.entries({ ...process.env, TMUX: undefined, TMUX_TMPDIR: cwd }).filter(
          (entry): entry is [string, string] => entry[1] !== undefined
        )
      );
      const tmux = createBoundExec({ file: 'tmux', cwd, env });
      const launch = async (...args: Parameters<typeof buildTmuxShellLine>) => {
        const { shellLine, env: launchEnv } = buildTmuxShellLine(...args);
        await createBoundExec({ file: '/bin/sh', cwd, env: launchEnv })
          .exec(['-c', shellLine])
          .catch(() => {});
      };
      const ctx = stubExecContext((_file, args) => tmux.exec(args ?? []));
      const identity = 'project:task:terminal';

      try {
        const created = await resolveTmuxSession(ctx, { identity, label: 'Fix login' });
        await launch(created.name, { command: 'sleep', args: ['30'] }, env, identity);

        await expect(
          resolveTmuxSession(ctx, { identity, label: 'renamed-workspace' })
        ).resolves.toMatchObject({ name: created.name, exists: true });
        await tmux.exec(['rename-session', '-t', `=${created.name}`, 'manually-renamed']);
        await expect(
          resolveTmuxSession(ctx, { identity, label: 'renamed-workspace' })
        ).resolves.toMatchObject({ name: 'manually-renamed', exists: true });
        await tmux.exec(['kill-session', '-t', '=manually-renamed']);

        const legacyName = makeLegacyTmuxSessionName(identity);
        await tmux.exec(['new-session', '-d', '-s', legacyName, 'sleep 30']);
        const before = await tmux.exec([
          'display-message',
          '-p',
          '-t',
          `=${legacyName}`,
          '#{pane_pid}',
        ]);
        const legacy = await resolveTmuxSession(ctx, { identity, label: 'Fix login' });
        await launch(legacy.name, { command: '/bin/sh', args: ['-c', 'exit 99'] }, env);
        const after = await tmux.exec([
          'display-message',
          '-p',
          '-t',
          `=${legacyName}`,
          '#{pane_pid}',
        ]);
        const sessions = await tmux.exec(['list-sessions', '-F', '#{session_name}']);

        expect(legacy).toEqual({ name: legacyName, exists: true, writeIdentity: false });
        expect(after.stdout).toBe(before.stdout);
        expect(sessions.stdout.trim().split('\n')).toEqual([legacyName]);

        await tmux.exec(['kill-session', '-t', `=${legacyName}`]);
        const prefixIdentity = 'project:task:prefix-target';
        const prefixName = makeTmuxSessionName(prefixIdentity, 'prefix');
        await tmux.exec(['new-session', '-d', '-s', `${prefixName}-sibling`, 'sleep 30']);
        const missingExact = await resolveTmuxSession(ctx, {
          identity: prefixIdentity,
          label: 'prefix',
        });
        await launch(missingExact.name, { command: 'sleep', args: ['30'] }, env, prefixIdentity);
        const exactSessions = await tmux.exec(['list-sessions', '-F', '#{session_name}']);
        expect(exactSessions.stdout.trim().split('\n').sort()).toEqual(
          [prefixName, `${prefixName}-sibling`].sort()
        );
      } finally {
        await tmux.exec(['kill-server']).catch(() => {});
        await rm(cwd, { recursive: true, force: true });
      }
    }
  );
});

describe('parseTmuxSessionActivity', () => {
  it('parses session activity timestamps as milliseconds', () => {
    const identity = 'project:task:leaf';
    const encoded = Buffer.from(JSON.stringify({ version: 1, identity }), 'utf8').toString(
      'base64url'
    );
    const parsed = parseTmuxSessionActivity(
      `one\t1710000000\tv1:${encoded}\ntwo\t1710000005\t\ninvalid\n`
    );

    expect(parsed).toEqual(
      new Map([
        ['one', 1_710_000_000_000],
        [tmuxIdentityActivityKey(identity), 1_710_000_000_000],
        ['two', 1_710_000_005_000],
      ])
    );
  });
});

describe('listTmuxSessionActivity', () => {
  it('runs one tmux list-sessions command', async () => {
    const exec = vi.fn(async () => ({ stdout: 'name\t42\t\n', stderr: '' }));
    const ctx = stubExecContext(exec);

    const activity = await listTmuxSessionActivity(ctx);

    expect(exec).toHaveBeenCalledWith('tmux', [
      'list-sessions',
      '-F',
      '#{session_name}\t#{session_activity}\t#{@emdash_identity}',
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
