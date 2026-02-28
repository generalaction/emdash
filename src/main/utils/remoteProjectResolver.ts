import { databaseService, type Project } from '../services/DatabaseService';

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

export async function resolveRemoteProjectForWorktreePath(
  worktreePath: string
): Promise<RemoteProject | null> {
  const all = await databaseService.getProjects();
  // Pick the longest matching remotePath prefix.
  const candidates = all
    .filter((p) => isRemoteProject(p))
    .filter((p) => worktreePath.startsWith(p.remotePath.replace(/\/+$/g, '') + '/'))
    .sort((a, b) => b.remotePath.length - a.remotePath.length);
  return candidates[0] ?? null;
}
