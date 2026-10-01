import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { workspaceRelayCommand, WORKSPACE_RELAY_SOURCE } from './stdio-relay';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
describe('workspace daemon stdio attachment', () => {
  it('uses the existing packaged runtime and safely passes paths as arguments', () => {
    const command = workspaceRelayCommand(
      "/home/alice's files/.emdash/workspace-server/run/workspace.sock"
    );
    expect(command.command).toBe("/home/alice's files/.emdash/workspace-server/current/node");
    expect(command.args).toEqual([
      '-e',
      WORKSPACE_RELAY_SOURCE,
      "/home/alice's files/.emdash/workspace-server/run/workspace.sock",
    ]);
  });
  it.each([
    'relative.sock',
    '/tmp/../run/workspace.sock',
    '/tmp/run/workspace.sock\n',
    '/tmp/other.sock',
  ])('rejects an invalid managed socket path: %j', (path) => {
    expect(() => workspaceRelayCommand(path)).toThrow();
  });
  it.skipIf(process.platform === 'win32')(
    'relays binary data and detaches without stopping the daemon',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'emdash-relay-'));
      cleanups.push(() => rm(directory, { recursive: true, force: true }));
      const socketPath = join(directory, 'daemon.sock');
      const server = createServer((socket) => socket.pipe(socket));
      await new Promise<void>((resolve) => server.listen(socketPath, resolve));
      cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
      for (let i = 0; i < 2; i++) {
        const child = spawn(process.execPath, ['-e', WORKSPACE_RELAY_SOURCE, socketPath], {
          stdio: 'pipe',
        });
        try {
          await once(child, 'spawn');
          const result = once(child.stdout, 'data');
          child.stdin.write(Buffer.from([0, 255, 10, 13]));
          expect((await result)[0]).toEqual(Buffer.from([0, 255, 10, 13]));
        } finally {
          const closed = once(child, 'close');
          child.kill();
          await closed;
        }
      }
      expect(server.listening).toBe(true);
    }
  );
});
