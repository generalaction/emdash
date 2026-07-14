import {
  getDesktopWireClient,
  resetDesktopWireClient,
  type DesktopWireClient,
} from './desktop-wire-client';

export type FilesRuntimeClient = DesktopWireClient['files'];

export async function getFilesRuntimeClient(): Promise<FilesRuntimeClient> {
  return (await getDesktopWireClient()).files;
}

export function resetFilesRuntimeClient(): void {
  resetDesktopWireClient();
}
