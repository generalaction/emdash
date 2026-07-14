import { awaitWirePort, client, connect, domPortTransport, type DomPortLike } from '@emdash/wire';
import { projectsWireContract } from '@shared/core/projects/wire-contract';
import { PROJECTS_WIRE_CHANNEL } from '@shared/core/runtime/wire-channels';

export type ProjectsWireClient = ReturnType<typeof createProjectsClientForPort>;

let clientPromise: Promise<ProjectsWireClient> | null = null;

export function getProjectsWireClient(): Promise<ProjectsWireClient> {
  clientPromise ??= createProjectsWireClient();
  return clientPromise;
}

export function resetProjectsWireClient(): void {
  clientPromise = null;
}

async function createProjectsWireClient(): Promise<ProjectsWireClient> {
  const portPromise = awaitWirePort(window, { channel: PROJECTS_WIRE_CHANNEL });
  await window.electronAPI.requestWirePort(PROJECTS_WIRE_CHANNEL);
  return createProjectsClientForPort((await portPromise) as DomPortLike);
}

function createProjectsClientForPort(port: DomPortLike) {
  return client(projectsWireContract, connect(domPortTransport(port)));
}
