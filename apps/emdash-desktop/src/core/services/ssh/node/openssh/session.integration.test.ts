import { once } from 'node:events';
import { rename, writeFile } from 'node:fs/promises';
import { createServer, connect } from 'node:net';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { connectOpenSsh, type SshSession } from './session';
import { startTestSshd } from './testing/sshd';

describe.skipIf(process.platform === 'win32').each([true, false])(
  'real OpenSSH sessions (multiplex: %s)',
  (multiplex) => {
    let fixture: Awaited<ReturnType<typeof startTestSshd>>;
    const sessions: SshSession[] = [];
    beforeAll(async () => {
      fixture = await startTestSshd();
    }, 30000);
    afterEach(async () => {
      for (const session of sessions.splice(0)) await session.close();
    });
    afterAll(async () => {
      await fixture?.close();
    });
    async function session() {
      const result = await connectOpenSsh(fixture.config, { multiplex });
      sessions.push(result);
      return result;
    }
    it('keeps sessions foregrounded and duplex despite user session directives', async () => {
      const file = join(fixture.directory, 'session-options');
      await writeFile(
        file,
        'Host *\n  StdinNull yes\n  SessionType none\n  ForkAfterAuthentication yes\n'
      );
      const args = [...fixture.config.args];
      args[args.indexOf('-F') + 1] = file;
      const ssh = await connectOpenSsh(
        { ...fixture.config, args, readyTimeout: 1000 },
        { multiplex }
      );
      sessions.push(ssh);
      expect((await ssh.exec('printf usable')).stdout).toBe('usable');
    });
    it('does not send newer directives to an OpenSSH 8.1 client', async () => {
      const executable = join(fixture.directory, 'ssh-8.1');
      await writeFile(
        executable,
        `#!/bin/sh
if [ "$1" = "-V" ]; then echo 'OpenSSH_8.1p1' >&2; exit 0; fi
for arg do
  case "$arg" in ForkAfterAuthentication=*|StdinNull=*|SessionType=*) echo 'Bad configuration option' >&2; exit 255;; esac
done
exec ssh "$@"
`,
        { mode: 0o700 }
      );
      const ssh = await connectOpenSsh({ ...fixture.config, executable }, { multiplex });
      sessions.push(ssh);
      expect((await ssh.exec('printf compatible')).stdout).toBe('compatible');
    });
    it('connects, executes commands and reports the actual exit status', async () => {
      const ssh = await session();
      await expect(ssh.exec("printf 'hello'; printf 'error' >&2; exit 7")).resolves.toEqual({
        stdout: 'hello',
        stderr: 'error',
        exitCode: 7,
      });
    });
    it('distinguishes a command that exits 255 from an SSH authentication failure', async () => {
      const ssh = await session();
      expect((await ssh.exec('exit 255')).exitCode).toBe(255);
    });
    it('opens a binary-clean duplex command stream', async () => {
      const ssh = await session();
      const stream = await ssh.openStream('cat');
      const echoed = once(stream, 'data');
      stream.write(Buffer.from([0, 255, 10, 13, 128]));
      expect((await echoed)[0]).toEqual(Buffer.from([0, 255, 10, 13, 128]));
      stream.destroy();
    });
    it('cancels commands and streams when the connection is retired', async () => {
      const ssh = await session();
      const stream = await ssh.openStream('cat');
      const closed = new Promise<void>((resolve) => stream.once('close', resolve));
      const command = ssh.exec('sleep 60');
      const rejected = expect(command).rejects.toThrow();
      await ssh.close();
      await rejected;
      await closed;
      expect(stream.destroyed).toBe(true);
      await expect(ssh.exec('true')).rejects.toThrow();
    });
    it.for(['127.0.0.1', '::1'])(
      'forwards a preview listening only on %s',
      async (host, context) => {
        const server = createServer((socket) => socket.pipe(socket));
        try {
          await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, host, resolve);
          });
        } catch (error) {
          if (!process.env.CI && (error as NodeJS.ErrnoException).code === 'EAFNOSUPPORT')
            context.skip('Host has IPv6 disabled');
          throw error;
        }
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Expected TCP address');
        const ssh = await session();
        const forward = await ssh.forwardPort(address.port);
        const socket = connect(forward.localPort, '127.0.0.1');
        try {
          const data = once(socket, 'data');
          socket.write('preview');
          expect((await data)[0].toString()).toBe('preview');
        } finally {
          socket.destroy();
          await forward.close();
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      }
    );
    it.runIf(multiplex)('reuses its authenticated connection for later operations', async () => {
      const ssh = await session();
      await rename(fixture.key, `${fixture.key}.moved`);
      try {
        expect((await ssh.exec('printf reused')).stdout).toBe('reused');
      } finally {
        await rename(`${fixture.key}.moved`, fixture.key);
      }
    });
    it('releases a closed forward so the same local port can be reused', async () => {
      const ssh = await session();
      const first = await ssh.forwardPort(65530);
      const port = first.localPort;
      await first.close();
      const second = await ssh.forwardPort(65530, { preferredLocalPort: port });
      try {
        expect(second.localPort).toBe(port);
      } finally {
        await second.close();
      }
    });
    it('bounds remote output and remains usable after a cancelled operation', async () => {
      const ssh = await session();
      await expect(ssh.exec('yes x', { maxStdoutBytes: 16 })).rejects.toThrow('limit');
      await expect(ssh.exec('sleep 60', { timeoutMs: 50 })).rejects.toThrow('timed out');
      expect((await ssh.exec('printf healthy')).stdout).toBe('healthy');
    });
    it('retries only a local bind collision and releases forwards on retirement', async () => {
      const ssh = await session();
      const forward = await ssh.forwardPort(65530, { preferredLocalPort: fixture.port });
      expect(forward.localPort).not.toBe(fixture.port);
      await ssh.close();
      await forward.closed;
      await expect(ssh.forwardPort(65530)).rejects.toThrow();
    });
    it('rejects an untrusted host key', async () => {
      const config = { ...fixture.config, args: [...fixture.config.args] };
      config.args[config.args.findIndex((value) => value.startsWith('UserKnownHostsFile='))] =
        'UserKnownHostsFile=/dev/null';
      await expect(connectOpenSsh(config)).rejects.toThrow(/host key/i);
    });
    it('rejects a missing OpenSSH executable with an actionable error', async () => {
      await expect(
        connectOpenSsh({ ...fixture.config, executable: '/emdash-missing-ssh' })
      ).rejects.toThrow(/OpenSSH.*not found/i);
    });
  }
);
