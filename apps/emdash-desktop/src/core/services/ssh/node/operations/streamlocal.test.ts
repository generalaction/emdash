import { generateKeyPairSync } from 'node:crypto';
import { once } from 'node:events';
import { Client, Server } from 'ssh2';
import { describe, expect, it } from 'vitest';
import type { SshConfig } from '@core/primitives/ssh/api';
import { resolveSshConnectConfig } from '../connect/resolve-ssh-connect-config';
import { forwardOutStreamLocalOnClient } from './streamlocal';

const { privateKey: hostKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
});

describe('forwardOutStreamLocalOnClient', () => {
  it('opens streamlocal on a compatible server with a non-OpenSSH banner', async () => {
    let observedSocketPath: string | undefined;
    const server = new Server({ hostKeys: [hostKey], ident: 'Tailscale' });
    server.on('connection', (connection) => {
      connection.on('authentication', (context) => context.accept());
      connection.on('ready', () => {
        connection.on('openssh.streamlocal', (accept, _reject, info) => {
          observedSocketPath = info.socketPath;
          accept().end();
        });
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');

    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP server address');

    const input = {
      id: 'tailscale-test',
      name: 'Tailscale test',
      host: '127.0.0.1',
      port: address.port,
      username: 'alice',
      authType: 'password',
      useAgent: false,
      password: 'secret',
    } satisfies SshConfig & { password: string };
    const resolved = await resolveSshConnectConfig({ kind: 'transient', config: input });
    const client = new Client();

    try {
      client.connect(resolved.config);
      await once(client, 'ready');

      const channel = await forwardOutStreamLocalOnClient(client, '/tmp/workspace.sock');
      channel.destroy();

      expect(observedSocketPath).toBe('/tmp/workspace.sock');
    } finally {
      client.end();
      server.close();
    }
  });
});
