import { useMemo } from 'react';
import { useAppContext } from '../contexts/AppContextProvider';
import type { Project } from '../types/app';

/**
 * Derives SSH connection info for the given project.
 * Works for both projects that explicitly store remote fields and for
 * legacy projects where remoteness is inferred from the path heuristic.
 */
export function useProjectRemoteInfo(project: Project | null): {
  connectionId: string | null;
  remotePath: string | null;
} {
  const { platform } = useAppContext();

  const connectionId = useMemo((): string | null => {
    if (!project) return null;
    if (project.sshConnectionId) return project.sshConnectionId;

    const alias = project.name;
    if (typeof alias !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(alias)) return null;

    // Back-compat: on macOS/Windows a /home/... path is almost certainly remote.
    const p = project.path || '';
    const looksRemoteByPath =
      platform === 'darwin' || platform === 'win32' ? p.startsWith('/home/') : false;

    if (project.isRemote || looksRemoteByPath) {
      return `ssh-config:${encodeURIComponent(alias)}`;
    }
    return null;
  }, [project, platform]);

  const remotePath = useMemo((): string | null => {
    if (!project) return null;
    if (project.remotePath) return project.remotePath;
    if (connectionId) return project.path;
    return project.isRemote ? project.path : null;
  }, [project, connectionId]);

  return { connectionId, remotePath };
}
