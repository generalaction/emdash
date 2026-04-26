import type { Project } from '../types/app';

export function getProjectRemoteLocator(project: Project): { sshConnectionId?: string } {
  return { sshConnectionId: project.sshConnectionId ?? undefined };
}
