import { filesContract } from '@emdash/core/files';
import { awaitWirePort, client, connect, domPortTransport, type DomPortLike } from '@emdash/wire';
import { FILES_WIRE_CHANNEL } from '@shared/core/runtime/wire-channels';

export type FilesRuntimeClient = ReturnType<typeof createFilesClientForPort>;

let clientPromise: Promise<FilesRuntimeClient> | null = null;

export function getFilesRuntimeClient(): Promise<FilesRuntimeClient> {
  clientPromise ??= createFilesRuntimeClient();
  return clientPromise;
}

export function resetFilesRuntimeClient(): void {
  clientPromise = null;
}

async function createFilesRuntimeClient(): Promise<FilesRuntimeClient> {
  const portPromise = awaitWirePort(window, { channel: FILES_WIRE_CHANNEL });
  await window.electronAPI.requestWirePort(FILES_WIRE_CHANNEL);
  return createFilesClientForPort((await portPromise) as DomPortLike);
}

function createFilesClientForPort(port: DomPortLike) {
  return client(filesContract, connect(domPortTransport(port)));
}
