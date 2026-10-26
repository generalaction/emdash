import { execFile, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { formatCommandLine, quoteArg } from '#primitives/exec/api';
import type { GitCredentialsSessionSpec } from '#primitives/git-credentials/api';
import {
  resolveLocalPtySpawn,
  type PtySpawnIntent,
  type ResolvedPtyShellProfile,
} from './local-spawn';
import { buildTerminalEnv } from './terminal-env';

const exec = promisify(execFile);
const hasTmux = process.platform !== 'win32' && spawnSync('tmux', ['-V']).status === 0;

describe.skipIf(!hasTmux)('tmux task environment isolation', () => {
  it.each(['run-command', 'interactive-shell'] as const)(
    'isolates successive and concurrent %s launches on an existing server',
    async (kind) => {
      const fixture = await createFixture();
      try {
        const first = await fixture.launch('first', kind, {
          EMDASH_TASK_NAME: 'first',
          EMDASH_TEST_TOKEN: 'synthetic-first-token',
        });
        expect(first.env.EMDASH_TASK_NAME).toBe('first');
        expect(first.env.EMDASH_TEST_TOKEN).toBe('synthetic-first-token');

        const special = 'quotes \' " backslash \\ dollar $(exit 42) `exit 43`\nlast\n';
        const [second, third] = await Promise.all([
          fixture.launch('second', kind, {
            EMDASH_TASK_NAME: 'second',
            EMDASH_TEST_TOKEN: undefined,
            EMDASH_TEST_VALUE: special,
            EMDASH_TEST_EMPTY: '',
            EMDASH_TEST_SEMICOLON: 'literal\\;',
            EMDASH_TEST_SEPARATOR: 'literal;',
          }),
          fixture.launch('third', kind, {
            EMDASH_TASK_NAME: 'third',
            EMDASH_TEST_TOKEN: 'synthetic-third-token',
          }),
        ]);

        expect(second.env.EMDASH_TASK_NAME).toBe('second');
        expect(second.env).not.toHaveProperty('EMDASH_TEST_TOKEN');
        expect(second.env).not.toHaveProperty('EMDASH_SERVER_ONLY');
        expect(second.env.EMDASH_TEST_VALUE).toBe(special);
        expect(second.env.EMDASH_TEST_EMPTY).toBe('');
        expect(second.env.EMDASH_TEST_SEMICOLON).toBe('literal\\;');
        expect(second.env.EMDASH_TEST_SEPARATOR).toBe('literal;');
        expect(third.env.EMDASH_TASK_NAME).toBe('third');
        expect(third.env.EMDASH_TEST_TOKEN).toBe('synthetic-third-token');
        expect(third.env).not.toHaveProperty('EMDASH_TEST_VALUE');
        expect(second.cwd).toBe(fixture.cwd);
        expect(second.env.SHELL).toBe('/bin/sh');
        expect(second.env.TERM).toBe('screen');
        expect(second.env.TMUX).toContain(fixture.directory);
        expect(second.env.TMUX_PANE).toMatch(/^%\d+$/);
        expect(
          await fixture.tmux(['display-message', '-p', '-t', '=third', '#{pane_start_command}'])
        ).not.toContain('synthetic-third-token');

        const panePid = await fixture.tmux([
          'display-message',
          '-p',
          '-t',
          '=second',
          '#{pane_pid}',
        ]);
        await fixture.tmux(['kill-session', '-t', '=first']);
        // Reattaching must keep the original process and its context.
        const reattached = await fixture.launch('second', kind, { EMDASH_TASK_NAME: 'changed' });
        expect(reattached).toEqual(second);
        expect(await fixture.tmux(['display-message', '-p', '-t', '=second', '#{pane_pid}'])).toBe(
          panePid
        );
        expect(await fixture.tmux(['show-environment', '-g', 'EMDASH_TASK_NAME'])).toBe(
          'EMDASH_TASK_NAME=server\n'
        );
      } finally {
        await fixture.dispose();
      }
    }
  );

  it('never passes task values through process arguments', async () => {
    const fixture = await createFixture();
    const secrets = ['synthetic-argv-nonce', 'synthetic-argv-key', '"q\'uoted;'];
    const sampler = sampleProcessArguments(secrets);
    try {
      const overrides = {
        EMDASH_GIT_CREDENTIAL_NONCE: secrets[0],
        EMDASH_TEST_API_KEY: secrets[1],
        EMDASH_TEST_VALUE: secrets[2],
      };
      const [command, shell] = await Promise.all([
        fixture.launch('argv-command', 'run-command', overrides),
        fixture.launch('argv-shell', 'interactive-shell', overrides),
      ]);
      expect(command.env).toMatchObject(overrides);
      expect(shell.env).toMatchObject(overrides);

      const tmuxArguments = await readFile(fixture.tmuxArgumentLog, 'utf8');
      expect(tmuxArguments).toContain('new-session');
      for (const secret of secrets) expect(tmuxArguments).not.toContain(secret);
      expect(await sampler.stop()).toEqual([]);
    } finally {
      await sampler.stop();
      await fixture.dispose();
    }
  });

  it('transfers large environments and removes its private channel', async () => {
    const fixture = await createFixture();
    try {
      // Together these exceed Linux's 128 KiB limit for a single environment string, and
      // quoting alone takes the single quotes past it.
      const large = {
        EMDASH_TEST_LARGE_A: 'a'.repeat(60_000),
        EMDASH_TEST_LARGE_B: 'b'.repeat(60_000),
        EMDASH_TEST_LARGE_LINES: 'line\n'.repeat(2_000),
        EMDASH_TEST_LARGE_QUOTES: "'".repeat(40_000),
        EMDASH_TEST_LARGE_EMOJIS: '\u{1F600}'.repeat(20_000),
      };
      // Short names like the launcher's own variables must round-trip unchanged.
      const shortNames = { d: 'd\n', l: 'l\n', n: 'n\n', p: 'p', s: 's', t: 't' };
      const result = await fixture.launch('large', 'run-command', {
        ...large,
        ...shortNames,
        EMDASH_TMUX_ENV: 'reserved',
        // Readonly in bash; the restore must continue past it.
        UID: '0',
        EMDASH_TASK_NAME: 'large',
      });
      expect(result.env).toMatchObject({ ...large, ...shortNames, EMDASH_TASK_NAME: 'large' });
      expect(Object.keys(result.env).filter((key) => key.startsWith('EMDASH_TMUX_ENV'))).toEqual(
        []
      );
      const entries = await readdir(fixture.directory);
      expect(entries.filter((name) => name.startsWith('emdash-tmux.'))).toEqual([]);
    } finally {
      await fixture.dispose();
    }
  }, 20_000);

  it('keeps removed credential channels absent and empty askpass values intact', async () => {
    const fixture = await createFixture();
    try {
      const result = await fixture.launch(
        'no-credentials',
        'run-command',
        {
          EMDASH_GIT_CREDENTIAL_PORT: '12345',
          EMDASH_GIT_CREDENTIAL_NONCE: 'synthetic-inherited-nonce',
          GIT_ASKPASS: '/inherited/askpass',
        },
        { gitCredentials: { mode: 'none' } }
      );
      expect(result.env).not.toHaveProperty('EMDASH_GIT_CREDENTIAL_PORT');
      expect(result.env).not.toHaveProperty('EMDASH_GIT_CREDENTIAL_NONCE');
      expect(result.env.GIT_ASKPASS).toBe('');
      expect(result.env.SSH_ASKPASS).toBe('');
      expect(result.env.GIT_CONFIG_PARAMETERS).toContain("'credential.helper'=''");
    } finally {
      await fixture.dispose();
    }
  });

  it('runs the selected shell and setup once, after restoring the task environment', async () => {
    const fixture = await createFixture();
    try {
      const shell = join(fixture.directory, 'selected-shell');
      const log = join(fixture.directory, 'shell-starts');
      await writeFile(
        shell,
        `#!/bin/sh\nprintf '%s\\n' "$EMDASH_TASK_NAME" >> ${quoteArg(log, 'posix')}\nexec /bin/bash "$@"\n`,
        { mode: 0o700 }
      );
      const result = await fixture.launch(
        'selected-shell',
        'run-command',
        { EMDASH_TASK_NAME: 'selected' },
        {
          shellProfile: {
            id: 'selected',
            resolvedShellId: 'selected',
            resolvedFromSystem: false,
            executable: shell,
            family: 'posix',
            commandArgs: ['-c'],
            interactiveArgs: ['-i'],
          },
          // Bash syntax verifies that setup uses the selected shell, not tmux's.
          shellSetup: 'values=(setup-ok); export EMDASH_SETUP_MARKER=${values[0]}',
        }
      );
      expect(await readFile(log, 'utf8')).toBe('selected\n');
      expect(result.env.EMDASH_SETUP_MARKER).toBe('setup-ok');
      expect(result.env.SHELL).toBe(shell);
    } finally {
      await fixture.dispose();
    }
  });
});

type Observation = { env: Record<string, string>; cwd: string; pid: number };

/** Best-effort: records any process whose arguments show a secret while launches run. */
function sampleProcessArguments(secrets: string[]) {
  const hits = new Set<string>();
  let running = true;
  const readArguments = async () => {
    if (process.platform !== 'linux') {
      return (await exec('ps', ['-A', '-ww', '-o', 'args='], { maxBuffer: 1 << 26 })).stdout;
    }
    const entries = (await readdir('/proc')).filter((entry) => /^\d+$/.test(entry));
    const args = await Promise.all(
      entries.map((pid) => readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => ''))
    );
    return args.map((value) => value.replaceAll('\0', ' ')).join('\n');
  };
  const loop = (async () => {
    while (running) {
      for (const line of (await readArguments()).split('\n')) {
        if (secrets.some((secret) => line.includes(secret))) hits.add(line.slice(0, 200));
      }
    }
  })();
  return {
    async stop() {
      running = false;
      await loop;
      return [...hits];
    },
  };
}

async function createFixture() {
  // Keep the socket path short enough for macOS's Unix socket limit.
  const directory = await mkdtemp('/tmp/emdash-tmux-env-');
  const cwd = await realpath(directory);
  // Record every tmux client's arguments before running the real tmux.
  const tmuxArgumentLog = join(directory, 'tmux-arguments');
  const bin = join(directory, 'bin');
  const realTmux = spawnSync('/bin/sh', ['-c', 'command -v tmux'], { encoding: 'utf8' });
  await mkdir(bin);
  await writeFile(
    join(bin, 'tmux'),
    `#!/bin/sh\nfor arg in "$@"; do printf '%s\\n' "$arg"; done >> ${quoteArg(tmuxArgumentLog, 'posix')}\nexec ${quoteArg(realTmux.stdout.trim(), 'posix')} "$@"\n`,
    { mode: 0o700 }
  );
  const baseEnv = {
    PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`,
    SHELL: '/bin/sh',
    TMPDIR: directory,
    TMUX_TMPDIR: directory,
    EMDASH_TEST_TOKEN: 'synthetic-base-token',
  };
  const tmux = async (args: string[]) =>
    (await exec('tmux', args, { env: baseEnv, cwd, timeout: 5_000 })).stdout;
  const probe = join(directory, 'probe.cjs');
  await writeFile(
    probe,
    "require('node:fs').writeFileSync(process.argv[2], JSON.stringify({ env: process.env, cwd: process.cwd(), pid: process.pid })); setInterval(() => {}, 1000);"
  );
  await exec('tmux', ['-f', '/dev/null', 'new-session', '-d', '-s', 'server', 'sleep 30'], {
    env: {
      ...baseEnv,
      EMDASH_TASK_NAME: 'server',
      EMDASH_TEST_TOKEN: 'synthetic-server-token',
      EMDASH_SERVER_ONLY: 'must-not-reach-the-task',
      EMDASH_GIT_CREDENTIAL_PORT: '9999',
      EMDASH_GIT_CREDENTIAL_NONCE: 'synthetic-server-nonce',
    },
    cwd,
    timeout: 5_000,
  });
  await tmux(['set-option', '-g', 'default-terminal', 'screen']);
  await tmux(['set-option', '-g', 'default-shell', '/bin/bash']);

  return {
    directory,
    cwd,
    tmux,
    tmuxArgumentLog,
    async launch(
      name: string,
      kind: 'run-command' | 'interactive-shell',
      overrides: Record<string, string | undefined>,
      options: {
        gitCredentials?: GitCredentialsSessionSpec;
        shellProfile?: ResolvedPtyShellProfile;
        shellSetup?: string;
      } = {}
    ): Promise<Observation> {
      const output = join(directory, `${name}.json`);
      const command = { command: process.execPath, args: [probe, output] };
      const common = {
        cwd,
        tmux: { name, identity: `project:${name}:session` },
        shellProfile: options.shellProfile,
      };
      const intent: PtySpawnIntent =
        kind === 'run-command'
          ? {
              ...common,
              kind,
              command: { kind: 'argv', ...command },
              shellSetup: options.shellSetup,
            }
          : { ...common, kind, shellSetup: formatCommandLine(command, 'posix') };
      const { invocation, env } = resolveLocalPtySpawn({
        intent,
        env: buildTerminalEnv({ baseEnv, overrides, ...options }),
        platform: process.platform,
      });
      if (invocation.kind !== 'argv') throw new Error('Expected POSIX argv invocation');
      // No client TTY is needed: creation succeeds and attachment reports that
      // stdin is not a terminal. The actual pane process remains running.
      await exec(invocation.executable, invocation.argv, { env, cwd, timeout: 5_000 }).catch(
        (error: unknown) => {
          expect(error).toMatchObject({ stderr: expect.stringContaining('not a terminal') });
        }
      );
      await expect.poll(() => readFile(output, 'utf8')).toBeTruthy();
      return JSON.parse(await readFile(output, 'utf8')) as Observation;
    },
    async dispose() {
      await tmux(['kill-server']).catch(() => {});
      await rm(directory, { recursive: true, force: true });
    },
  };
}
