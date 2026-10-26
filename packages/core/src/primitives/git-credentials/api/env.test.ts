import { execFile, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  applyGitCredentialsToEnv,
  GIT_CREDENTIAL_HELPER_COMMAND,
  GIT_CREDENTIAL_HELPER_TIMEOUT_SECONDS,
  gitCredentialOperationEnv,
  type GitCredentialsSessionSpec,
} from './env';

const channel = { port: 45678, nonce: 'channel-nonce-1234' };

const helperSpec: GitCredentialsSessionSpec = {
  mode: 'effective-account',
  channel,
  hosts: ['github.com'],
};

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
  it('contains no single quotes, so GIT_CONFIG_PARAMETERS carries it verbatim', () => {
    expect(GIT_CREDENTIAL_HELPER_COMMAND).not.toContain("'");
  });

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

type GitCredentialRun = { status: number | null; stdout: string; stderr: string };

/**
 * Runs `git credential <action>` through the real helper and curl in an isolated
 * home, so only the given `curlrc` and env reach the request.
 */
async function runGitCredential(
  action: 'fill' | 'reject',
  helperEnv: Record<string, string>,
  input: string,
  options: { env?: Record<string, string>; curlrc?: string } = {}
): Promise<GitCredentialRun> {
  const home = mkdtempSync(join(tmpdir(), 'emdash-helper-home-'));
  try {
    if (options.curlrc !== undefined) writeFileSync(join(home, '.curlrc'), options.curlrc);
    return await new Promise((resolve) => {
      const child = execFile(
        'git',
        ['credential', action],
        {
          cwd: home,
          env: {
            PATH: process.env.PATH,
            HOME: home,
            CURL_HOME: home,
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: devNull,
            GIT_TERMINAL_PROMPT: '0',
            ...helperEnv,
            ...options.env,
          },
          encoding: 'utf8',
          timeout: 10_000,
        },
        (error, stdout, stderr) => {
          const status = error ? (typeof error.code === 'number' ? error.code : null) : 0;
          resolve({ status, stdout, stderr });
        }
      );
      child.stdin?.end(input);
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

/** A loopback credential service that records each request it answers. */
async function withCredentialService(
  respond: (response: ServerResponse) => void,
  run: (port: number, requests: string[]) => Promise<void>
): Promise<void> {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url} ${request.headers['x-emdash-token']}`);
    request.resume();
    request.on('end', () => respond(response));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await run((server.address() as AddressInfo).port, requests);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

async function unusedLoopbackPort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  return port;
}

function helperEnvFor(port: number): Record<string, string> {
  return applyGitCredentialsToEnv(
    {},
    { mode: 'effective-account', channel: { ...channel, port }, hosts: ['github.com'] }
  );
}

/** Every process's argv as `ps` lists it, which any local user can read. */
async function processArgvs(): Promise<string> {
  const { stdout } = await promisify(execFile)('ps', ['-A', '-ww', '-o', 'args=']);
  return stdout;
}

const credentialRequest = 'protocol=https\nhost=github.com\n\n';
const credentialResponse = 'username=emdash-test\npassword=synthetic-test-password\n';

describe.skipIf(process.platform === 'win32')('GIT_CREDENTIAL_HELPER_COMMAND with git', () => {
  it('reaches the loopback service directly when proxy variables are set', async () => {
    const proxy = `http://127.0.0.1:${await unusedLoopbackPort()}`;
    await withCredentialService(
      (response) => response.end(credentialResponse),
      async (port, requests) => {
        const result = await runGitCredential('fill', helperEnvFor(port), credentialRequest, {
          env: { http_proxy: proxy, HTTP_PROXY: proxy, all_proxy: proxy, ALL_PROXY: proxy },
        });
        expect(result.stdout).toContain('username=emdash-test');
        expect(requests).toEqual([`POST /git-credential/get ${channel.nonce}`]);
      }
    );
  });

  it('ignores curlrc options that would reroute the request or reshape its output', async () => {
    const proxy = `http://127.0.0.1:${await unusedLoopbackPort()}`;
    await withCredentialService(
      (response) => response.end(credentialResponse),
      async (port) => {
        const result = await runGitCredential('fill', helperEnvFor(port), credentialRequest, {
          // `include` would prepend response headers to the lines git parses.
          curlrc: `proxy = "${proxy}"\ninclude\n`,
        });
        expect(result.stderr).toBe('');
        expect(result.stdout).toContain('username=emdash-test');
      }
    );
  });

  it('keeps the nonce out of every process argv while the request is in flight', async () => {
    // Unique, so no unrelated process on the machine can carry it.
    const nonce = randomUUID();
    let argvs = '';
    let servicePort = 0;
    await withCredentialService(
      async (response) => {
        argvs = await processArgvs();
        response.end(credentialResponse);
      },
      async (port) => {
        servicePort = port;
        const env = applyGitCredentialsToEnv(
          {},
          { mode: 'effective-account', channel: { port, nonce }, hosts: ['github.com'] }
        );
        const result = await runGitCredential('fill', env, credentialRequest);
        expect(result.stdout).toContain('username=emdash-test');
      }
    );
    // The listing caught curl mid-request, without its nonce.
    const curl = argvs.split('\n').find((argv) => argv.includes(`127.0.0.1:${servicePort}/`));
    expect(curl).toMatch(/^curl -q --noproxy \* -K \/dev\/fd\/3 /);
    expect(argvs).not.toContain(nonce);
  });

  it('reports an unreachable credential service instead of failing silently', async () => {
    const port = await unusedLoopbackPort();
    const result = await runGitCredential('fill', helperEnvFor(port), credentialRequest);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      `emdash: cannot reach the Emdash Git credential service at 127.0.0.1:${port};`
    );
  });

  it('reports a credential the service did not return', async () => {
    await withCredentialService(
      (response) => {
        response.writeHead(403);
        response.end();
      },
      async (port) => {
        const result = await runGitCredential('fill', helperEnvFor(port), credentialRequest);
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(
          'emdash: Emdash did not return a Git credential for this session;'
        );
      }
    );
  });

  it('reports a session that lost its credential channel', async () => {
    const env = applyGitCredentialsToEnv({}, helperSpec);
    delete env.EMDASH_GIT_CREDENTIAL_PORT;
    delete env.EMDASH_GIT_CREDENTIAL_NONCE;
    const result = await runGitCredential('fill', env, credentialRequest);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('emdash: this session has no Emdash Git credential channel;');
  });

  it('keeps erase best-effort and quiet when the service is unreachable', async () => {
    const port = await unusedLoopbackPort();
    const result = await runGitCredential(
      'reject',
      helperEnvFor(port),
      `${credentialRequest.trimEnd()}\nusername=emdash-test\npassword=stale\n\n`
    );
    expect(result).toMatchObject({ status: 0, stderr: '' });
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
