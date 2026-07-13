import {
  ensureFilesWorkerReady,
  filesClient,
  type FilesRuntimeClient,
} from '@main/core/wire-workers/desktop-workers';

export type { FilesRuntimeClient } from '@main/core/wire-workers/desktop-workers';

export async function getFilesRuntimeClient(): Promise<FilesRuntimeClient> {
  await ensureFilesWorkerReady();
  return filesClient;
}
