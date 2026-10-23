import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyGitCredentialsToEnv,
  GIT_CREDENTIAL_HELPER_COMMAND,
  GIT_CREDENTIAL_HELPER_TIMEOUT_SECONDS,
  gitCredentialOperationEnv,
  type GitCredentialsSessionSpec,
} from './env';

const channel = { port: 45678, nonce: 'channel-nonce-1234' };

async function listenOnLoopback(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('expected TCP address');
  return address.port;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
}

async function unusedLoopbackPort(): Promise<number> {
  const server = createServer();
  const port = await listenOnLoopback(server);
  await closeServer(server);
  return port;
}

const helperSpec: GitCredentialsSessionSpec = {
  mode: 'effective-account',
  channel,
  hosts: ['github.com'],
};

function credentialEnv(env: Record<string, string>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: devNull,
    GIT_TERMINAL_PROMPT: '0',
    NO_PROXY: '127.0.0.1,localhost',
    no_proxy: '127.0.0.1,localhost',
  };
}

function runGitCredential(action: string, env: Record<string, string>, input: string) {
  return spawnSync('git', ['credential', action], {
    input,
    encoding: 'utf8',
    env: credentialEnv(env),
  });
}

const gitCredentialInput = 'protocol=https\nhost=github.com\n\n';

function helperEnvForPort(port: number): Record<string, string> {
  return applyGitCredentialsToEnv(
    {},
    { mode: 'effective-account', channel: { ...channel, port }, hosts: ['github.com'] }
  );
}

function gitConfigPairs(env: Record<string, string>): [string, string][] {
  const output = execFileSync('git', ['config', '--null', '--list'], {
    cwd: tmpdir(),
    env: {
      ...env,
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: devNull,
    },
    encoding: 'utf8',
  });
  return output
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf('\n');
      return [entry.slice(0, separator), entry.slice(separator + 1)];
    });
}

/**
 * Runs the helper as git does (`<helper> <action>`) with a stub curl that, like
 * the real one, reads the request body from stdin, then echoes its URL. Pass
 * `request` only for actions the helper forwards: for the others nothing reads
 * stdin, so writing a request could fail with EPIPE once the shell exits.
 */
function runHelper(action: string, request?: string): string {
  const bin = mkdtempSync(join(tmpdir(), 'emdash-helper-'));
  try {
    writeFileSync(
      join(bin, 'curl'),
      '#!/bin/sh\ncat >/dev/null\nfor arg; do last=$arg; done\necho "$last"\n'
    );
    chmodSync(join(bin, 'curl'), 0o755);
    return execFileSync(
      'sh',
      ['-c', `${GIT_CREDENTIAL_HELPER_COMMAND.slice(1)} "$@"`, 'sh', action],
      {
        env: {
          PATH: `${bin}:${process.env.PATH}`,
          EMDASH_GIT_CREDENTIAL_PORT: String(channel.port),
          EMDASH_GIT_CREDENTIAL_NONCE: channel.nonce,
        },
        ...(request !== undefined ? { input: request } : {}),
        encoding: 'utf8',
      }
    );
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
}

describe('GIT_CREDENTIAL_HELPER_COMMAND', () => {
  it.skipIf(process.platform === 'win32')('forwards get and erase to their endpoints', () => {
    const request = 'protocol=https\nhost=github.com\n\n';
    expect(runHelper('get', request)).toBe(`http://127.0.0.1:${channel.port}/git-credential/get\n`);
    expect(runHelper('erase', request)).toBe(
      `http://127.0.0.1:${channel.port}/git-credential/erase\n`
    );
  });

  it('waits longer than a credential read that renews the token', () => {
    expect(GIT_CREDENTIAL_HELPER_TIMEOUT_SECONDS).toBeGreaterThan(60);
    expect(GIT_CREDENTIAL_HELPER_COMMAND).toContain(`-m ${GIT_CREDENTIAL_HELPER_TIMEOUT_SECONDS} `);
  });

  it.skipIf(process.platform === 'win32')('sends nothing for other actions', () => {
    for (const action of ['store', 'get;id', 'get erase', '']) {
      expect(runHelper(action)).toBe('');
    }
  });
});

describe('applyGitCredentialsToEnv', () => {
  it('returns the env untouched for system mode and for no spec', () => {
    const env = {
      PATH: '/bin',
      GIT_ASKPASS: '/usr/bin/whatever',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'credential.helper',
      GIT_CONFIG_VALUE_0: '',
      GIT_CONFIG_PARAMETERS: "'user.name'='Inherited'",
    };
    expect(applyGitCredentialsToEnv(env, { mode: 'system' })).toBe(env);
    expect(applyGitCredentialsToEnv(env, undefined)).toEqual(env);
  });

  describe('effective-account mode', () => {
    it('wires the helper for each host with a reset entry first', () => {
      const env = applyGitCredentialsToEnv({ PATH: '/bin' }, helperSpec);
      expect(env.EMDASH_GIT_CREDENTIAL_PORT).toBe('45678');
      expect(env.EMDASH_GIT_CREDENTIAL_NONCE).toBe('channel-nonce-1234');
      expect(gitConfigPairs(env)).toEqual([
        ['credential.https://github.com.helper', ''],
        ['credential.https://github.com.helper', GIT_CREDENTIAL_HELPER_COMMAND],
      ]);
    });

    it('appends after pre-existing GIT_CONFIG entries instead of clobbering them', () => {
      const env = applyGitCredentialsToEnv(
        {
          GIT_CONFIG_COUNT: '1',
          GIT_CONFIG_KEY_0: 'user.name',
          GIT_CONFIG_VALUE_0: 'Someone',
        },
        helperSpec
      );
      expect(gitConfigPairs(env)).toEqual([
        ['user.name', 'Someone'],
        ['credential.https://github.com.helper', ''],
        ['credential.https://github.com.helper', GIT_CREDENTIAL_HELPER_COMMAND],
      ]);
    });

    it('references the channel through env vars, never inline in config values', () => {
      const env = applyGitCredentialsToEnv({}, helperSpec);
      for (const [, value] of gitConfigPairs(env)) {
        expect(value).not.toContain(channel.nonce);
        expect(value).not.toContain(String(channel.port));
      }
    });

    it('does not touch askpass behavior', () => {
      const env = applyGitCredentialsToEnv({ GIT_ASKPASS: '/usr/bin/x' }, helperSpec);
      expect(env.GIT_ASKPASS).toBe('/usr/bin/x');
    });

    it('reports a failed credential proxy request instead of swallowing its failure', async () => {
      const port = await unusedLoopbackPort();
      const result = runGitCredential('fill', helperEnvForPort(port), gitCredentialInput);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        'emdash: credential proxy request failed at 127.0.0.1:' + port
      );
    });
  });

  describe('none mode', () => {
    it('scrubs askpass and resets credential helpers', () => {
      const env = applyGitCredentialsToEnv(
        { PATH: '/bin', GIT_ASKPASS: '/usr/bin/x', SSH_ASKPASS: '/usr/bin/y' },
        { mode: 'none' }
      );
      expect(env.GIT_ASKPASS).toBe('');
      expect(env.SSH_ASKPASS).toBe('');
      expect(gitConfigPairs(env)).toEqual([['credential.helper', '']]);
    });

    it('drops credential.helper overrides from pre-existing GIT_CONFIG entries', () => {
      const env = applyGitCredentialsToEnv(
        {
          GIT_CONFIG_COUNT: '3',
          GIT_CONFIG_KEY_0: 'credential.helper',
          GIT_CONFIG_VALUE_0: '!leaky',
          GIT_CONFIG_KEY_1: 'user.name',
          GIT_CONFIG_VALUE_1: 'Someone',
          GIT_CONFIG_KEY_2: 'credential.https://github.com.helper',
          GIT_CONFIG_VALUE_2: '!leaky-too',
        },
        { mode: 'none' }
      );
      expect(gitConfigPairs(env)).toEqual([
        ['user.name', 'Someone'],
        ['credential.helper', ''],
      ]);
    });

    it('removes an emdash helper channel if one is present', () => {
      const helperEnv = applyGitCredentialsToEnv({ PATH: '/bin' }, helperSpec);
      const scrubbed = applyGitCredentialsToEnv(helperEnv, { mode: 'none' });
      expect(scrubbed.EMDASH_GIT_CREDENTIAL_PORT).toBeUndefined();
      expect(scrubbed.EMDASH_GIT_CREDENTIAL_NONCE).toBeUndefined();
      expect(gitConfigPairs(scrubbed).at(-1)).toEqual(['credential.helper', '']);
    });
  });
});

describe('gitCredentialOperationEnv', () => {
  it('preserves unrelated inherited parameters when used as an operation overlay', () => {
    const env = {
      GIT_CONFIG_PARAMETERS: "'user.name'='Inherited'",
      ...gitCredentialOperationEnv(channel, 'github.com'),
    };
    expect(gitConfigPairs(env)).toContainEqual(['user.name', 'Inherited']);
  });

  it('produces a standalone overlay for one host', () => {
    const env = gitCredentialOperationEnv(channel, 'github.example.com');
    expect(env.EMDASH_GIT_CREDENTIAL_PORT).toBe('45678');
    expect(gitConfigPairs(env)).toEqual([
      ['credential.https://github.example.com.helper', ''],
      ['credential.https://github.example.com.helper', GIT_CREDENTIAL_HELPER_COMMAND],
    ]);
  });
});
