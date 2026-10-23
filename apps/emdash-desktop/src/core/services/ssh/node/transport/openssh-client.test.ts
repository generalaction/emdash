import { generateKeyPairSync } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Server, utils, type Connection } from 'ssh2';
import { afterEach, describe, expect, it } from 'vitest';
import type { SshClientProxy } from '@core/primitives/ssh/api/node/ssh-client-proxy';
import { SshConnectionManager } from '../lifecycle/ssh-connection-manager';
import { OpenSshClient } from './openssh-client';

const hostKey = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
}).privateKey;
const cleanup: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});

interface Fixture {
  client: OpenSshClient;
  manager: SshConnectionManager;
  knownHosts: string;
  connections: Set<Connection>;
  serverErrors: Error[];
  directory: string;
}

function createServer(options: { rejectAuth?: boolean; stall?: boolean }): {
  server: Server;
  connections: Set<Connection>;
  serverErrors: Error[];
} {
  const server = new Server({ hostKeys: [hostKey] });
  const connections = new Set<Connection>();
  const serverErrors: Error[] = [];
  server.on('connection', (connection) => {
    connections.add(connection);
    // 保留主动断线时的服务器错误，正常会话测试会断言没有协议错误。
    connection.on('error', (error: Error) => serverErrors.push(error));
    connection.on('authentication', (ctx) => (options.rejectAuth ? ctx.reject() : ctx.accept()));
    connection.on('ready', () => handleConnection(connection, !!options.stall));
  });
  return { server, connections, serverErrors };
}

type FixtureOptions = {
  rejectAuth?: boolean;
  stall?: boolean;
  forwardFault?: 'reject' | 'lost-ack' | 'timeout';
};

async function fixture(options: FixtureOptions = {}): Promise<Fixture> {
  const { server, connections, serverErrors } = createServer(options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  cleanup.push(() => {
    for (const c of connections) c.end();
    server.close();
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address');
  const directory = mkdtempSync(join(tmpdir(), 'emdash-openssh-test-'));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const knownHosts = join(directory, 'known_hosts');
  const key = utils.parseKey(hostKey);
  if (key instanceof Error) throw key;
  writeFileSync(
    knownHosts,
    `[127.0.0.1]:${address.port} ${key.type} ${key.getPublicSSH().toString('base64')}\n`
  );
  const executable = createExecutable(directory, knownHosts, options.forwardFault);
  const client = new OpenSshClient(
    { host: '127.0.0.1', port: address.port, username: 'test' },
    executable
  );
  const manager = new SshConnectionManager();
  cleanup.push(() => manager.disconnectAll());
  return { client, manager, knownHosts, connections, serverErrors, directory };
}

function createExecutable(
  directory: string,
  knownHosts: string,
  fault?: 'reject' | 'lost-ack' | 'timeout'
): string {
  const executable = join(directory, 'ssh');
  const ssh = `/usr/bin/ssh -o GSSAPIAuthentication=no -o PreferredAuthentications=none -o 'UserKnownHostsFile=${knownHosts}'`;
  // 故障只作用于首次转发；lost-ack 用真实 OpenSSH 创建监听后模拟确认丢失。
  const inject = fault
    ? `
case " $* " in
  *" -O forward "*)
    if [ ! -f '${directory}/attempted' ]; then
      touch '${directory}/attempted'
      ${fault !== 'reject' ? `${ssh} "$@" || exit $?` : ':'}
      printf '%s\\n' "$@" > '${directory}/forward-args'
      ${fault === 'timeout' ? 'exec /bin/sleep 60' : "echo 'fixture forwarding failure' >&2; exit 1"}
    fi
    ;;
esac
`
    : '';
  writeFileSync(executable, `#!/bin/sh\n${inject}exec ${ssh} "$@"\n`, { mode: 0o700 });
  return executable;
}

function handleConnection(connection: Connection, stall: boolean): void {
  connection.on('session', (accept) => {
    accept().on('exec', (acceptExec, _reject, info) => {
      const channel = acceptExec();
      const marker = info.command.match(/emdash-ready-[a-f0-9-]+/)?.[0];
      if (marker) {
        if (!stall) channel.write(`${marker}\n`);
        return;
      }
      if (info.command === 'hang') return;
      if (info.command === 'overflow') channel.write(Buffer.alloc(4096));
      else {
        channel.write('hello 世界\n');
        channel.stderr.write('diagnostic\n');
      }
      channel.exit(7);
      channel.end();
    });
  });
  connection.on('openssh.streamlocal', (accept) => {
    const channel = accept();
    channel.on('data', (chunk: Buffer) => channel.write(chunk));
  });
  connection.on('tcpip', (accept) => {
    const channel = accept();
    channel.on('data', (chunk: Buffer) => channel.write(chunk));
  });
}

async function connect(f: Fixture, timeoutMs = 5000): Promise<SshClientProxy> {
  return f.manager.createConnection('test', async () => ({
    client: f.client,
    config: { readyTimeout: timeoutMs },
    cleanup: () => {},
    debugLogs: [],
  }));
}

async function expectForwardRecovery(
  forwardFault: NonNullable<FixtureOptions['forwardFault']>,
  expectedError: RegExp
): Promise<void> {
  const f = await fixture({ forwardFault });
  const proxy = await connect(f);
  // 直接观察控制命令自身的10秒超时，避免代理层相同期限的计时器先结束断言。
  const first =
    forwardFault === 'timeout'
      ? new Promise<unknown>((resolve, reject) => {
          f.client.openssh_forwardOutStreamLocal('/tmp/retry.sock', (error, channel) => {
            if (error) reject(error);
            else resolve(channel);
          });
        })
      : proxy.forwardOutStreamLocal('/tmp/retry.sock');
  await expect(first).rejects.toThrow(expectedError);
  const args = readFileSync(join(f.directory, 'forward-args'), 'utf8').trim().split('\n');
  const listener = args[args.indexOf('-L') + 1]!.split(':')[0]!;
  expect(existsSync(listener)).toBe(false);
  expect(proxy.isConnected).toBe(true);
  const channel = await proxy.forwardOutStreamLocal('/tmp/retry.sock');
  const received = once(channel, 'data');
  channel.write('recovered');
  expect((await received)[0].toString()).toBe('recovered');
  channel.destroy();
  expect(f.connections.size).toBe(1);
}

describe.skipIf(process.platform === 'win32')('system OpenSSH transport', () => {
  it('preserves stdout, stderr and nonzero exit status', async () => {
    const f = await fixture();
    const proxy = await connect(f);
    expect(await proxy.execScript('exit-test')).toEqual({
      stdout: 'hello 世界\n',
      stderr: 'diagnostic\n',
      exitCode: 7,
    });
    expect(f.serverErrors).toEqual([]);
  });

  it('forwards binary data over streamlocal and TCP channels', async () => {
    const f = await fixture();
    const proxy = await connect(f);
    const channels = [
      await proxy.forwardOutStreamLocal('/tmp/workspace.sock'),
      await proxy.openTcpChannel({
        sourceHost: '127.0.0.1',
        sourcePort: 0,
        remoteHost: '127.0.0.1',
        remotePort: 1234,
      }),
    ];
    for (const channel of channels) {
      const received = once(channel, 'data');
      const bytes = Buffer.from([0, 255, 128, 10]);
      channel.write(bytes);
      expect((await received)[0]).toEqual(bytes);
      channel.destroy();
    }
  });

  it.each(['reject', 'lost-ack'] as const)(
    'recovers a %s forward on the same physical connection',
    (forwardFault) => expectForwardRecovery(forwardFault, /fixture forwarding failure/)
  );

  it(
    'cleans up a listener after a real control-command timeout',
    () => expectForwardRecovery('timeout', /SSH socket forwarding/),
    15_000
  );

  it('bounds execution and output and retires channels on disconnect', async () => {
    const f = await fixture();
    const proxy = await connect(f);
    await expect(proxy.execScript('hang', { timeoutMs: 50 })).rejects.toThrow('timed out');
    await expect(proxy.execScript('overflow', { maxStdoutBytes: 10 })).rejects.toThrow('exceeded');
    const command = proxy.execScript('hang');
    const rejected = expect(command).rejects.toThrow();
    f.manager.resetConnection('test');
    await rejected;
    expect(proxy.isConnected).toBe(false);
    expect(() => proxy.execScript('exit-test')).toThrow('not available');
  });

  it('retires the physical connection when the master is disconnected remotely', async () => {
    const f = await fixture();
    const proxy = await connect(f);
    const closed = once(f.client, 'close');
    for (const connection of f.connections) connection.end();
    await closed;
    expect(proxy.isConnected).toBe(false);
    expect(() => proxy.execScript('exit-test')).toThrow('not available');
  });

  it('rejects authentication failure with actionable guidance', async () => {
    const f = await fixture({ rejectAuth: true });
    await expect(connect(f)).rejects.toThrow(/kinit/);
    expect(f.manager.isConnected('test')).toBe(false);
  });

  it('rejects untrusted host keys instead of accepting them automatically', async () => {
    const f = await fixture();
    writeFileSync(f.knownHosts, '');
    await expect(connect(f)).rejects.toThrow(/Host key verification failed/);
  });

  it('bounds stalled establishment and cancels it without publishing ready', async () => {
    const f = await fixture({ stall: true });
    await expect(connect(f, 200)).rejects.toThrow('timed out');
    expect(f.manager.isConnected('test')).toBe(false);
  });
});
