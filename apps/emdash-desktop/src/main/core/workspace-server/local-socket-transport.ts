import { createConnection, type Socket } from 'node:net';
import { streamTransport, type WireTransport } from '@emdash/wire';
import type { LocalWorkspaceServerTarget } from './workspace-server-client-source';

export type OpenLocalWorkspaceServerTransportOptions = {
  connectTimeoutMs?: number;
};

const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;

export async function openLocalWorkspaceServerTransport(
  target: LocalWorkspaceServerTarget,
  options: OpenLocalWorkspaceServerTransportOptions = {}
): Promise<WireTransport> {
  const socket = await connectLocalSocket(
    target.socketPath,
    options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
  );
  return ownedSocketTransport(socket);
}

export function ownedSocketTransport(socket: Socket): WireTransport {
  const transport = streamTransport(socket, socket);
  let closed = false;
  return {
    ...transport,
    close() {
      if (closed) return;
      closed = true;
      transport.close?.();
      socket.destroy();
    },
  };
}

function connectLocalSocket(socketPath: string, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let settled = false;
    const timeout = setTimeout(() => {
      finish(new Error(`Timed out connecting to workspace server socket: ${socketPath}`));
    }, timeoutMs);
    timeout.unref?.();

    const cleanup = (): void => {
      clearTimeout(timeout);
      socket.off('connect', onConnect);
      socket.off('error', onError);
    };
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        socket.destroy();
        reject(error);
        return;
      }
      resolve(socket);
    };
    const onConnect = (): void => finish();
    const onError = (error: Error): void => finish(error);

    socket.once('connect', onConnect);
    socket.once('error', onError);
  });
}
