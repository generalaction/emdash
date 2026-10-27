import { execFile, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyGitCredentialsToEnv,
  type GitCredentialsSessionSpec,
} from '#primitives/git-credentials/api';
import { buildTerminalEnv } from './terminal-env';

const cwd = mkdtempSync(join(tmpdir(), 'emdash-credential-env-'));
beforeAll(() => {
  git({}, ['init', '--quiet']);
});
afterAll(() => rmSync(cwd, { recursive: true, force: true }));

const baseEnv = {
  PATH: process.env.PATH ?? '',
  ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
  HOME: cwd,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: devNull,
  GIT_TERMINAL_PROMPT: '0',
};
const spec: GitCredentialsSessionSpec = {
  mode: 'effective-account',
  channel: { port: 1, nonce: 'test-only' },
  hosts: ['github.com'],
};

function git(env: Record<string, string>, args: string[], input?: string) {
  return execFileSync('git', args, {
    cwd,
    env: { ...baseEnv, ...env },
    input,
    encoding: 'utf8',
    timeout: 10_000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function dropEmpty(env: Record<string, string>) {
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
}

describe('credential config across child environment filtering', () => {
  it.each([spec, { mode: 'none' } as const])('keeps Git usable in $mode mode', (mode) => {
    const env = dropEmpty(buildTerminalEnv({ baseEnv, gitCredentials: mode }));
    expect(() => git(env, ['config', '--list'])).not.toThrow();
    expect(git(env, ['rev-parse', '--is-inside-work-tree'])).toBe('true\n');
    expect(
      git(env, [
        'config',
        '--get-all',
        mode.mode === 'none' ? 'credential.helper' : 'credential.https://github.com.helper',
      ]).startsWith('\n')
    ).toBe(true);
  });

  it('preserves indexed and parameter config, including empty and quoted values, in Git order', () => {
    const value = 'quotes \' and "; backslash \\; dollar $HOME; newline\nnext';
    const env = dropEmpty(
      applyGitCredentialsToEnv(
        {
          GIT_CONFIG_COUNT: '2',
          GIT_CONFIG_KEY_0: 'test.value',
          GIT_CONFIG_VALUE_0: value,
          GIT_CONFIG_KEY_1: 'test.empty',
          GIT_CONFIG_VALUE_1: '',
          GIT_CONFIG_PARAMETERS: "'test.value'='inherited'",
        },
        spec
      )
    );
    expect(git(env, ['config', '--get-all', 'test.value'])).toBe(`${value}\ninherited\n`);
    expect(git(env, ['config', '--get', 'test.empty'])).toBe('\n');
    expect(git(env, ['-c', 'test.value=explicit', 'config', '--get', 'test.value'])).toBe(
      'explicit\n'
    );
  });

  it.each([spec, { mode: 'none' } as const])('resets inherited helpers in $mode mode', (mode) => {
    const env = dropEmpty(
      applyGitCredentialsToEnv(
        {
          GIT_CONFIG_PARAMETERS: "'credential.helper'='!echo username=wrong; echo password=wrong'",
        },
        mode
      )
    );
    // The Emdash test channel is deliberately unavailable. Neither mode may
    // fall back to the inherited helper and authenticate as the wrong account.
    expect(() => git(env, ['credential', 'fill'], 'protocol=https\nhost=github.com\n\n')).toThrow(
      /could not read Username|unable to get password from user/
    );
    if (mode.mode === 'effective-account') {
      expect(git(env, ['credential', 'fill'], 'protocol=https\nhost=example.com\n\n')).toContain(
        'username=wrong'
      );
    }
  });

  it('authenticates through the real terminal helper after filtering, without using inherited helpers', async () => {
    const requests: { url: string | undefined; nonce: string | string[] | undefined }[] = [];
    const server = createServer((request, response) => {
      requests.push({ url: request.url, nonce: request.headers['x-emdash-token'] });
      request.resume();
      response.end('username=emdash-test\npassword=synthetic-test-password\n');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing test server port');
      const env = dropEmpty(
        buildTerminalEnv({
          baseEnv: {
            ...baseEnv,
            GIT_CONFIG_PARAMETERS:
              "'credential.helper'='!echo username=wrong; echo password=wrong'",
          },
          gitCredentials: {
            mode: 'effective-account',
            hosts: ['github.com'],
            channel: { port: address.port, nonce: 'test-channel' },
          },
        })
      );
      const stdout = await new Promise<string>((resolve, reject) => {
        const child = execFile(
          'git',
          ['credential', 'fill'],
          {
            cwd,
            env,
            encoding: 'utf8',
            timeout: 10_000,
          },
          (error, output) => (error ? reject(error) : resolve(output))
        );
        child.stdin?.end('protocol=https\nhost=github.com\n\n');
      });
      expect(stdout).toContain('username=emdash-test');
      expect(requests).toEqual([{ url: '/git-credential/get', nonce: 'test-channel' }]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
});
