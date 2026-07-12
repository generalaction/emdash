import { gitContract } from '@emdash/core/git';
import { awaitWirePort, client, connect, domPortTransport, type DomPortLike } from '@emdash/wire';
import { GIT_WIRE_CHANNEL } from '@shared/core/runtime/wire-channels';

export type GitRuntimeClient = ReturnType<typeof createGitClientForPort>;

let clientPromise: Promise<GitRuntimeClient> | null = null;

export function getGitRuntimeClient(): Promise<GitRuntimeClient> {
  clientPromise ??= createGitRuntimeClient();
  return clientPromise;
}

export function resetGitRuntimeClient(): void {
  clientPromise = null;
}

async function createGitRuntimeClient(): Promise<GitRuntimeClient> {
  const portPromise = awaitWirePort(window, { channel: GIT_WIRE_CHANNEL });
  await window.electronAPI.requestWirePort(GIT_WIRE_CHANNEL);
  return createGitClientForPort((await portPromise) as DomPortLike);
}

function createGitClientForPort(port: DomPortLike) {
  return client(gitContract, connect(domPortTransport(port)));
}
