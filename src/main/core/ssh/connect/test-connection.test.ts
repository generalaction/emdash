import { generateKeyPairSync } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { Client, Server } from 'ssh2';
import { afterEach, describe, expect, it } from 'vitest';
import type { SshConfig } from '@shared/ssh';
import { testSshConnection } from './test-connection';

const { privateKey: hostKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
});

async function startServer() {
  const server = new Server({ hostKeys: [hostKey] });
  server.on('connection', (client) => {
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password' && ctx.username === 'alice' && ctx.password === 'secret') {
        ctx.accept();
        return;
      }
      ctx.reject();
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
  return { server, port: address.port };
}

describe('testSshConnection', () => {
  const servers: Server[] = [];

  afterEach(() => {
    for (const server of servers.splice(0)) {
      server.close();
    }
  });

  it('uses the unified resolver output instead of the raw form host/port', async () => {
    const { server, port } = await startServer();
    servers.push(server);
    const cleanups: string[] = [];

    const config: SshConfig & { password?: string } = {
      id: '',
      name: 'Alias backed',
      host: 'wrong.example.com',
      port: 2222,
      username: 'nobody',
      sshConfigAlias: 'local-test',
      authType: 'password',
      password: 'secret',
    };

    await expect(
      testSshConnection(config, {
        createClient: () => new Client(),
        resolve: async () => ({
          config: {
            host: '127.0.0.1',
            port,
            username: 'alice',
            password: 'secret',
            readyTimeout: 5_000,
          },
          cleanup: () => cleanups.push('cleanup'),
          debugLogs: ['resolved via alias'],
        }),
      })
    ).resolves.toMatchObject({
      success: true,
      debugLogs: expect.arrayContaining(['resolved via alias']),
    });
    expect(cleanups).toEqual(['cleanup']);
  });

  it('fails and cleans up when the SSH client closes before ready', async () => {
    const cleanups: string[] = [];
    class ClosingClient extends EventEmitter {
      connect() {
        queueMicrotask(() => this.emit('close'));
      }
    }

    await expect(
      testSshConnection(
        {
          id: '',
          name: 'Closing',
          host: '127.0.0.1',
          port: 22,
          username: 'alice',
          authType: 'agent',
        },
        {
          createClient: () => new ClosingClient() as unknown as Client,
          resolve: async () => ({
            config: {
              host: '127.0.0.1',
              port: 22,
              username: 'alice',
              readyTimeout: 5_000,
            },
            cleanup: () => cleanups.push('cleanup'),
            debugLogs: ['resolved'],
          }),
        }
      )
    ).resolves.toMatchObject({
      success: false,
      error: 'SSH connection closed before ready',
      debugLogs: ['resolved'],
    });
    expect(cleanups).toEqual(['cleanup']);
  });

  it('reports resolver and client errors without leaking cleanup', async () => {
    await expect(
      testSshConnection(
        {
          id: '',
          name: 'Bad resolver',
          host: '127.0.0.1',
          port: 22,
          username: 'alice',
          authType: 'agent',
        },
        {
          createClient: () => new Client(),
          resolve: async () => {
            throw new Error('resolve failed');
          },
        }
      )
    ).resolves.toEqual({
      success: false,
      error: 'resolve failed',
      debugLogs: [],
    });

    const cleanups: string[] = [];
    class ErrorClient extends EventEmitter {
      connect() {
        queueMicrotask(() => this.emit('error', new Error('auth failed')));
      }
    }

    await expect(
      testSshConnection(
        {
          id: '',
          name: 'Client error',
          host: '127.0.0.1',
          port: 22,
          username: 'alice',
          authType: 'agent',
        },
        {
          createClient: () => new ErrorClient() as unknown as Client,
          resolve: async () => ({
            config: { host: '127.0.0.1', port: 22, username: 'alice' },
            cleanup: () => cleanups.push('cleanup'),
            debugLogs: ['resolved'],
          }),
        }
      )
    ).resolves.toEqual({
      success: false,
      error: 'auth failed',
      debugLogs: ['resolved'],
    });
    expect(cleanups).toEqual(['cleanup']);
  });

  it('reports synchronous client connect throws', async () => {
    const cleanups: string[] = [];
    class ThrowingClient extends EventEmitter {
      connect() {
        throw new Error('connect exploded');
      }
    }

    await expect(
      testSshConnection(
        {
          id: '',
          name: 'Sync throw',
          host: '127.0.0.1',
          port: 22,
          username: 'alice',
          authType: 'agent',
        },
        {
          createClient: () => new ThrowingClient() as unknown as Client,
          resolve: async () => ({
            config: { host: '127.0.0.1', port: 22, username: 'alice' },
            cleanup: () => cleanups.push('cleanup'),
            debugLogs: [],
          }),
        }
      )
    ).resolves.toMatchObject({
      success: false,
      error: 'connect exploded',
    });
    expect(cleanups).toEqual(['cleanup']);
  });
});
