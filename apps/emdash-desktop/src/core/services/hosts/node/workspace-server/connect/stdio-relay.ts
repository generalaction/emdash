import path from 'node:path';
import type { Command } from '@emdash/core/primitives/exec/api';

// Deliberately standalone JavaScript: executed by the Node bundled with *existing* server
// installations. No dependency on their CLI version, no runtime creation, no daemon signals.
export const WORKSPACE_RELAY_SOURCE = `
import('node:net').then(({ createConnection }) => {
  const socket = createConnection({ path: process.argv[1], allowHalfOpen: true });
  socket.once('connect', () => {
    process.stdin.pipe(socket);
    socket.pipe(process.stdout);
  });
  socket.on('error', (error) => {
    process.stderr.write('Workspace attachment failed: ' + error.message + '\\n');
    process.exitCode = 1;
  });
  socket.once('close', () => { process.stdin.destroy(); });
  process.stdin.on('error', () => socket.destroy());
  process.stdout.on('error', () => socket.destroy());
});
`;

export function workspaceRelayCommand(socketPath: string): Command {
  if (
    !path.posix.isAbsolute(socketPath) ||
    path.posix.normalize(socketPath) !== socketPath ||
    /[\0\r\n]/.test(socketPath) ||
    path.posix.basename(socketPath) !== 'workspace.sock' ||
    path.posix.basename(path.posix.dirname(socketPath)) !== 'run'
  ) {
    throw new Error('Invalid managed workspace-server socket path');
  }
  const root = path.posix.dirname(path.posix.dirname(socketPath));
  return {
    command: path.posix.join(root, 'current/node'),
    args: ['-e', WORKSPACE_RELAY_SOURCE, socketPath],
  };
}
