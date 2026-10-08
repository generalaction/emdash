import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { Client, OpenSSHAgent, type ConnectConfig } from 'ssh2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveSshConnectConfig } from './resolve-ssh-connect-config';

// Real OpenSSH tools against a throwaway CA, keys, ssh-agent and sshd in a temp dir.
// Nothing here reads the user's ~/.ssh or talks to their agent.

function hasCommand(command: string): boolean {
  try {
    execFileSync('sh', ['-c', `command -v ${command}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const SSHD = ['/usr/sbin/sshd', '/usr/bin/sshd'].find((path) => existsSync(path));
const hasTools = ['ssh-keygen', 'ssh-agent', 'ssh-add'].every(hasCommand);
const KEY_TYPES = ['ecdsa', 'rsa', 'ed25519'] as const;
type KeyType = (typeof KEY_TYPES)[number];

async function waitFor(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

function connect(config: ConnectConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    client
      .once('ready', () => {
        client.end();
        resolve();
      })
      .once('error', reject)
      .connect(config);
  });
}

describe.skipIf(!hasTools)('OpenSSH certificates held by the SSH agent', () => {
  const username = userInfo().username;
  const children: ChildProcess[] = [];
  const agents = new Map<KeyType, string>();
  let dir = '';
  let sshdPort: number | undefined;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'emdash-ssh-cert-'));
    const keygen = (...args: string[]) => execFileSync('ssh-keygen', ['-q', ...args]);
    keygen('-t', 'ed25519', '-N', '', '-C', 'test-ca', '-f', join(dir, 'ca'));

    for (const type of KEY_TYPES) {
      const key = join(dir, `id_${type}`);
      keygen('-t', type, '-N', '', '-C', 'testuser', '-f', key);
      keygen(
        '-s',
        join(dir, 'ca'),
        '-I',
        'testuser',
        '-n',
        username,
        '-V',
        '-5m:+1h',
        `${key}.pub`
      );

      const socket = join(dir, `${type}.sock`);
      children.push(spawn('ssh-agent', ['-D', '-a', socket], { stdio: 'ignore' }));
      await waitFor(() => existsSync(socket), `ssh-agent socket for ${type}`);
      // ssh-add loads id_<type>-cert.pub alongside the key.
      execFileSync('ssh-add', [key], {
        env: { ...process.env, SSH_AUTH_SOCK: socket },
        stdio: 'ignore',
      });
      agents.set(type, socket);
    }

    if (!SSHD) return;
    // The server trusts only the CA: no authorized_keys, so a bare key is rejected.
    keygen('-t', 'ed25519', '-N', '', '-f', join(dir, 'host_key'));
    const port = await freePort();
    writeFileSync(
      join(dir, 'sshd_config'),
      [
        `Port ${port}`,
        'ListenAddress 127.0.0.1',
        `HostKey ${join(dir, 'host_key')}`,
        'PidFile none',
        'UsePAM no',
        'StrictModes no',
        'AuthorizedKeysFile none',
        `TrustedUserCAKeys ${join(dir, 'ca.pub')}`,
        'AuthenticationMethods publickey',
        'PasswordAuthentication no',
        'KbdInteractiveAuthentication no',
        '',
      ].join('\n')
    );
    const sshd = spawn(SSHD, ['-D', '-e', '-f', join(dir, 'sshd_config')], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    children.push(sshd);
    let listening = false;
    let exited = false;
    let stderr = '';
    sshd.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.includes('Server listening')) listening = true;
    });
    sshd.once('exit', () => (exited = true));
    await waitFor(() => listening || exited, 'sshd to start').catch(() => undefined);
    if (listening && !exited) {
      sshdPort = port;
      return;
    }
    // Some local environments cannot run an unprivileged sshd, so the end-to-end tests skip
    // there. CI has sshd, so a startup failure must fail the run instead of skipping.
    const reason = `sshd did not start: ${stderr.trim() || 'no output'}`;
    if (process.env.CI) throw new Error(reason);
    console.warn(`Skipping CA-only authentication tests: ${reason}`);
  }, 60_000);

  afterAll(() => {
    for (const child of children) child.kill();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it.each(KEY_TYPES)('lists the %s certificate identity from the agent', async (type) => {
    const types = await new Promise<string[]>((resolve, reject) => {
      new OpenSSHAgent(agents.get(type)!).getIdentities((error, identities) =>
        error
          ? reject(error)
          : resolve((identities ?? []).map((key) => ('type' in key ? key.type : '')))
      );
    });

    expect(types).toContainEqual(expect.stringMatching(/-cert-v01@openssh\.com$/));
  });

  it.for(
    KEY_TYPES.flatMap((type) => [true, false].map((identitiesOnly) => ({ type, identitiesOnly })))
  )(
    'authenticates to a CA-only server with the $type certificate (IdentitiesOnly $identitiesOnly)',
    { timeout: 30_000 },
    async ({ type, identitiesOnly }, ctx) => {
      if (!sshdPort) ctx.skip();
      const socket = agents.get(type)!;
      const { config } = await resolveSshConnectConfig(
        {
          kind: 'transient',
          config: {
            id: 'ssh-cert',
            name: 'Cert',
            host: 'myhost.example.com',
            port: 22,
            username: 'testuser',
            authType: 'agent',
            useAgent: true,
            sshConfigAlias: 'cert-host',
          },
        },
        {
          resolveSshConfig: async () => ({
            hostname: '127.0.0.1',
            user: username,
            port: sshdPort!,
            identityFile: [join(dir, `id_${type}`)],
            identityAgent: socket,
            identityAgentDisabled: false,
            identitiesOnly,
            proxyCommand: undefined,
            proxyJump: undefined,
            forwardAgent: false,
          }),
          env: { SSH_AUTH_SOCK: socket },
        }
      );

      await expect(connect(config)).resolves.toBeUndefined();
    }
  );
});
