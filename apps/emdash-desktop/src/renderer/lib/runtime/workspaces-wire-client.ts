import { awaitWirePort, client, connect, domPortTransport, type DomPortLike } from '@emdash/wire';
import { WORKSPACES_WIRE_CHANNEL } from '@shared/core/runtime/wire-channels';
import { workspacesWireContract } from '@shared/core/workspaces/wire-contract';

export type WorkspacesWireClient = ReturnType<typeof createWorkspacesClientForPort>;

let clientPromise: Promise<WorkspacesWireClient> | null = null;

export function getWorkspacesWireClient(): Promise<WorkspacesWireClient> {
  clientPromise ??= createWorkspacesWireClient();
  return clientPromise;
}

export function resetWorkspacesWireClient(): void {
  clientPromise = null;
}

async function createWorkspacesWireClient(): Promise<WorkspacesWireClient> {
  const portPromise = awaitWirePort(window, { channel: WORKSPACES_WIRE_CHANNEL });
  await window.electronAPI.requestWirePort(WORKSPACES_WIRE_CHANNEL);
  return createWorkspacesClientForPort((await portPromise) as DomPortLike);
}

function createWorkspacesClientForPort(port: DomPortLike) {
  return client(workspacesWireContract, connect(domPortTransport(port)));
}
