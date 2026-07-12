import {
  filesClient,
  filesWorker,
  type FilesRuntimeClient,
} from '@main/core/wire-workers/desktop-workers';

export type { FilesRuntimeClient } from '@main/core/wire-workers/desktop-workers';

export async function getFilesRuntimeClient(): Promise<FilesRuntimeClient> {
  await filesWorker.ready();
  return filesClient;
}
