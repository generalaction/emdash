import {
  getDesktopWireClient,
  resetDesktopWireClient,
  type DesktopWireClient,
} from '@renderer/lib/runtime/desktop-wire-client';

export type WorkspacesWireClient = DesktopWireClient['workspaces'];

export async function getWorkspacesWireClient(): Promise<WorkspacesWireClient> {
  return (await getDesktopWireClient()).workspaces;
}

export type WorkspaceRegistryWireClient = DesktopWireClient['workspaceRegistry'];

export async function getWorkspaceRegistryWireClient(): Promise<WorkspaceRegistryWireClient> {
  return (await getDesktopWireClient()).workspaceRegistry;
}

export function resetWorkspacesWireClient(): void {
  resetDesktopWireClient();
}
