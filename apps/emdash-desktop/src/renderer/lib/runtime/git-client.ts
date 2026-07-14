import {
  getDesktopWireClient,
  resetDesktopWireClient,
  type DesktopWireClient,
} from './desktop-wire-client';

export type GitRuntimeClient = DesktopWireClient['git'];

export async function getGitRuntimeClient(): Promise<GitRuntimeClient> {
  return (await getDesktopWireClient()).git;
}

export function resetGitRuntimeClient(): void {
  resetDesktopWireClient();
}
