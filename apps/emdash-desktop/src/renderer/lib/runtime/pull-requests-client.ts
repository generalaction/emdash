import {
  getDesktopWireClient,
  resetDesktopWireClient,
  type DesktopWireClient,
} from './desktop-wire-client';

export type PullRequestsRuntimeClient = DesktopWireClient['pullRequests'];

export async function getPullRequestsRuntimeClient(): Promise<PullRequestsRuntimeClient> {
  return (await getDesktopWireClient()).pullRequests;
}

export function resetPullRequestsRuntimeClient(): void {
  resetDesktopWireClient();
}
