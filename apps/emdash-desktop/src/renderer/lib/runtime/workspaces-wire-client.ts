import {
  getDesktopWireClient,
  resetDesktopWireClient,
  type DesktopWireClient,
} from './desktop-wire-client';

export type WorkspacesWireClient = DesktopWireClient['workspaces'];

export async function getWorkspacesWireClient(): Promise<WorkspacesWireClient> {
  return (await getDesktopWireClient()).workspaces;
}

export function resetWorkspacesWireClient(): void {
  resetDesktopWireClient();
}
