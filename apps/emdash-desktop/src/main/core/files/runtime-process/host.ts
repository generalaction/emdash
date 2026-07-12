import { filesContract, type FilesContract } from '@emdash/core/files';
import {
  exposeWireToWindows,
  forwardController,
  withValidation,
  type ContractClient,
} from '@emdash/wire/api';
import { lazyWorker, type WorkerHandle } from '@emdash/wire/worker';
import { ipcMain, MessageChannelMain } from 'electron';
import { appScope } from '@main/app/app-scope';
import { desktopWorkerPath } from '@main/worker-manifest';
import { FILES_WIRE_CHANNEL } from '@shared/core/runtime/wire-channels';

const filesRuntimeScope = appScope.child('files-runtime-host');
const filesWorker = lazyWorker(
  () => ({
    name: 'files',
    contract: filesContract,
    entry: desktopWorkerPath('files'),
    scope: filesRuntimeScope,
    env: process.env,
  }),
  { onSpawned: (handle) => installRendererWire(handle.client) }
);

export type FilesRuntimeClient = ContractClient<FilesContract>;
export type FilesRuntimeHandle = WorkerHandle<FilesContract>;

let rendererWireDispose: (() => void) | null = null;

export function initializeFilesRuntimeProcess(): Promise<FilesRuntimeHandle> {
  return filesWorker.get();
}

export async function getFilesRuntimeClient(): Promise<FilesRuntimeClient> {
  return (await initializeFilesRuntimeProcess()).client;
}

export async function disposeFilesRuntimeProcess(): Promise<void> {
  rendererWireDispose?.();
  rendererWireDispose = null;
  await filesWorker.dispose();
}

function installRendererWire(client: FilesRuntimeClient): void {
  rendererWireDispose?.();
  const controller = withValidation(
    filesContract,
    forwardController(filesContract, client),
    import.meta.env.DEV ? 'full' : 'inputs'
  );
  rendererWireDispose = exposeWireToWindows(
    {
      ipcMain,
      createMessageChannel: () => {
        const channel = new MessageChannelMain();
        return { port1: channel.port1, port2: channel.port2 };
      },
    },
    controller,
    { channel: FILES_WIRE_CHANNEL }
  );
}
