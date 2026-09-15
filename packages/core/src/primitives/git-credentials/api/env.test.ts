import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { createServer, type Server } from 'node:net';
import { devNull, tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  applyGitCredentialsToEnv,
  GIT_CREDENTIAL_HELPER_COMMAND,
  gitCredentialOperationEnv,
  type GitCredentialsSessionSpec,
} from './env';

const channel = { port: 45678, nonce: 'channel-nonce-1234' };

async function listenOnLoopback(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
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
  };
}

function runGitCredential(action: string, env: Record<string, string>, input: string) {
  return spawnSync('git', ['credential', action], {
    input,
    encoding: 'utf8',
    env: credentialEnv(env),
  });
}

/** Non-blocking spawn, for the cases whose proxy is served by this process's own event loop. */
function spawnCapture(
  command: string,
  args: string[],
  env: Record<string, string>,
  input: string
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: credentialEnv(env) });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(input);
  });
}

const gitCredentialInput = 'protocol=https\nhost=github.com\n\n';

function runGitCredentialAsync(action: string, env: Record<string, string>, input: string) {
  return spawnCapture('git', ['credential', action], env, input);
}

/** Runs the helper the way git does — `sh -c '<command> <action>'` — to observe its own exit status. */
function runHelperAsync(action: string, env: Record<string, string>, input: string) {
  return spawnCapture(
    'sh',
    ['-c', `${GIT_CREDENTIAL_HELPER_COMMAND.slice(1)} ${action}`],
    env,
    input
  );
}

function helperEnvForPort(port: number): Record<string, string> {
  return applyGitCredentialsToEnv({}, { ...helperSpec, channel: { ...channel, port } });
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

    it('reports a proxy that answers with an http error', async () => {
      const proxy = createHttpServer((_request, response) => response.writeHead(403).end());
      const port = await listenOnLoopback(proxy);
      try {
        const result = await runGitCredentialAsync(
          'fill',
          helperEnvForPort(port),
          gitCredentialInput
        );
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(
          `emdash: credential proxy request failed at 127.0.0.1:${port}`
        );
      } finally {
        await closeServer(proxy);
      }
    });

    it('exits with curl\u2019s own status when the proxy request fails', async () => {
      const unusedPort = await unusedLoopbackPort();
      const refused = await runHelperAsync('get', helperEnvForPort(unusedPort), gitCredentialInput);
      expect(refused.status).toBe(7);

      const proxy = createHttpServer((_request, response) => response.writeHead(403).end());
      const port = await listenOnLoopback(proxy);
      try {
        const rejected = await runHelperAsync('get', helperEnvForPort(port), gitCredentialInput);
        expect(rejected.status).toBe(22);
      } finally {
        await closeServer(proxy);
      }
    });

    it('passes a proxy answer through to git untouched (control)', async () => {
      const tokens: (string | string[] | undefined)[] = [];
      const proxy = createHttpServer((request, response) => {
        tokens.push(request.headers['x-emdash-token']);
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end('protocol=https\nhost=github.com\nusername=octocat\npassword=hunter2\n');
      });
      const port = await listenOnLoopback(proxy);
      try {
        const result = await runGitCredentialAsync(
          'fill',
          helperEnvForPort(port),
          gitCredentialInput
        );
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('username=octocat');
        expect(result.stdout).toContain('password=hunter2');
        expect(result.stderr).not.toContain('emdash: credential proxy request failed');
        expect(tokens).toEqual([channel.nonce]);
      } finally {
        await closeServer(proxy);
      }
    });

    it('leaves store and erase proxy actions as no-ops (control)', () => {
      const env = helperEnvForPort(1);
      for (const action of ['approve', 'reject']) {
        const result = runGitCredential(
          action,
          env,
          'protocol=https\nhost=github.com\nusername=user\npassword=secret\n\n'
        );
        expect(result.status).toBe(0);
        expect(result.stderr).not.toContain('emdash: credential proxy request failed');
      }
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
