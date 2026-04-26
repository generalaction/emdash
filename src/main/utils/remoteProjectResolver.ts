import type { RemoteLocator } from '../../shared/ipc/remoteLocator';
import { databaseService, type Project } from '../services/DatabaseService';
import { workspaceProviderService } from '../services/WorkspaceProviderService';

export type RemoteProject = Project & { sshConnectionId: string; remotePath: string };

export function isRemoteProject(project: Project | null): project is RemoteProject {
  return !!(
    project &&
    project.isRemote &&
    typeof project.sshConnectionId === 'string' &&
    project.sshConnectionId.length > 0 &&
    typeof project.remotePath === 'string' &&
    project.remotePath.length > 0
  );
}

export interface RemoteContext {
  connectionId: string;
  remotePath: string;
}

export async function resolveRemoteContext(
  worktreePath: string,
  locator?: Pick<RemoteLocator, 'taskId' | 'sshConnectionId'>
): Promise<RemoteContext | null> {
  // Check workspace instances by taskId first
  if (locator?.taskId) {
    const instance = await workspaceProviderService.getActiveInstance(locator.taskId);
    if (instance?.connectionId && instance?.worktreePath) {
      return { connectionId: instance.connectionId, remotePath: instance.worktreePath };
    }
  }
  // Fall back to existing project-based SSH matching
  const project = await resolveRemoteProjectForWorktreePath(worktreePath, locator?.sshConnectionId);
  if (project) {
    return { connectionId: project.sshConnectionId, remotePath: worktreePath };
  }
  return null;
}

export async function resolveRemoteProjectForWorktreePath(
  worktreePath: string,
  sshConnectionId?: string
): Promise<RemoteProject | null> {
  const all = await databaseService.getProjects();
  // Pick the longest matching remotePath prefix.
  const candidates = all
    .filter((p) => isRemoteProject(p))
    .filter((p) => worktreePath.startsWith(p.remotePath.replace(/\/+$/g, '') + '/'))
    .filter((p) => !sshConnectionId || p.sshConnectionId === sshConnectionId)
    .sort((a, b) => b.remotePath.length - a.remotePath.length);

  if (candidates.length === 0) {
    return null;
  }

  if (candidates.length === 1) {
    return candidates[0]!;
  }

  // Multiple candidates found but no sshConnectionId provided to disambiguate
  throw new Error(
    `Multiple remote projects match path "${worktreePath}" but no sshConnectionId was provided to disambiguate. ` +
      `Matching projects: ${candidates.map((p) => `${p.remotePath} (${p.sshConnectionId})`).join(', ')}`
  );
}
