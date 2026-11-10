import { once } from 'node:events';
import ssh2 from 'ssh2';
import { afterEach, describe, expect, it } from 'vitest';
import { SshConnectionManager } from '../lifecycle/ssh-connection-manager';
import { defaultKnownHostsFiles, knownHostsName, type KnownHostsStore } from './known-hosts';
import { resolveSshConnectConfig } from './resolve-ssh-connect-config';

const { Server, utils } = ssh2;

// Real handshakes against an in-process SSH server. Which key a server presents depends on
// the algorithm order the client offers, so only a handshake shows whether a recorded host
// is still recognized.

/**
 * ssh2 drops a leading zero byte from an Ed25519 public key it generates, so about one
 * pair in 256 is one it cannot read back. Draw again, a few times at most.
 */
function generateEd25519(): ReturnType<typeof utils.generateKeyPairSync> {
  let failure: Error | undefined;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const pair = utils.generateKeyPairSync('ed25519');
    const parsed = utils.parseKey(pair.private);
    if (!(parsed instanceof Error)) return pair;
    failure = parsed;
  }
  throw new Error(`ssh2 cannot read back the Ed25519 keys it generates: ${failure?.message}`);
}

const HOME = '/home/test';
const KNOWN_HOSTS = defaultKnownHostsFiles(HOME, {}).user[0]!;
const ed25519 = generateEd25519();
const ecdsa = utils.generateKeyPairSync('ecdsa', { bits: 256 });

function memoryKnownHosts(content = ''): KnownHostsStore & { content(): string } {
  const files = new Map<string, string>(content ? [[KNOWN_HOSTS, content]] : []);
  return {
    content: () => files.get(KNOWN_HOSTS) ?? '',
    read: async (path) => files.get(path) ?? null,
    append: async (path, line) => {
      files.set(path, (files.get(path) ?? '') + line);
    },
  };
}

describe('host key verification over a real handshake', () => {
  const servers: InstanceType<typeof Server>[] = [];
  const manager = new SshConnectionManager();

  afterEach(async () => {
    await manager.disconnectAll();
    for (const server of servers.splice(0)) server.close();
  });

  /** A server that holds an Ed25519 and an ECDSA host key and lets anyone in. */
  async function startServer(): Promise<number> {
    const server = new Server({ hostKeys: [ed25519.private, ecdsa.private] });
    server.on('connection', (client) => {
      client.on('authentication', (context) => context.accept());
      client.on('error', () => {});
    });
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
    return address.port;
  }

  function connect(id: string, port: number, knownHosts: KnownHostsStore) {
    return manager.createConnection(id, () =>
      resolveSshConnectConfig(
        {
          kind: 'transient',
          config: {
            id: '',
            name: 'Test host',
            host: '127.0.0.1',
            port,
            username: 'alice',
            authType: 'password',
            password: 'secret',
          },
        },
        { knownHosts, homeDir: () => HOME, env: {} }
      )
    );
  }

  it('asks a recorded host for the key type on file rather than refusing another type', async () => {
    const port = await startServer();
    // Recorded years ago by a client that preferred ECDSA. ssh2 asks for Ed25519 first, and
    // this server has such a key too; presenting it would look like a different host key.
    const knownHosts = memoryKnownHosts(`${knownHostsName('127.0.0.1', port)} ${ecdsa.public}\n`);

    await expect(connect('ssh-1', port, knownHosts)).resolves.toBeDefined();
    expect(knownHosts.content().trim().split('\n')).toHaveLength(1);
  });

  it('refuses a server whose key changed and says how to recover', async () => {
    const port = await startServer();
    const previous = utils.generateKeyPairSync('ecdsa', { bits: 256 });
    const knownHosts = memoryKnownHosts(
      `${knownHostsName('127.0.0.1', port)} ${previous.public}\n`
    );

    await expect(connect('ssh-1', port, knownHosts)).rejects.toMatchObject({
      name: 'SshConnectionFailure',
      kind: 'host-key',
      message: expect.stringMatching(
        new RegExp(
          `^SSH host key for 127\\.0\\.0\\.1:${port} has changed: .* ssh-keygen -f .+ -R .+$`
        )
      ),
    });
    expect(knownHosts.content()).toContain(previous.public);
  });

  it('records a first-seen host and recognizes it on the next connection', async () => {
    const port = await startServer();
    const knownHosts = memoryKnownHosts();

    await expect(connect('ssh-1', port, knownHosts)).resolves.toBeDefined();
    await expect
      .poll(() => knownHosts.content())
      .toBe(`${knownHostsName('127.0.0.1', port)} ${ed25519.public}\n`);

    await expect(connect('ssh-2', port, knownHosts)).resolves.toBeDefined();
    expect(knownHosts.content().trim().split('\n')).toHaveLength(1);
  });
});
