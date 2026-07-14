import {
  getDesktopWireClient,
  resetDesktopWireClient,
  type DesktopWireClient,
} from './desktop-wire-client';

export type ProjectsWireClient = DesktopWireClient['projects'];

export async function getProjectsWireClient(): Promise<ProjectsWireClient> {
  return (await getDesktopWireClient()).projects;
}

export function resetProjectsWireClient(): void {
  resetDesktopWireClient();
}
