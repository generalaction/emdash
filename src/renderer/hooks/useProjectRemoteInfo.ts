import { useMemo } from 'react';
import { useAppContext } from '../contexts/AppContextProvider';
import { useProjectManagementContext } from '../contexts/ProjectManagementProvider';

/**
 * Derives SSH connection info for the currently selected project.
 * Works for both projects that explicitly store remote fields and for
 * legacy projects where remoteness is inferred from the path heuristic.
 */
export function useProjectRemoteInfo(): {
  connectionId: string | null;
  remotePath: string | null;
} {
  const { platform } = useAppContext();
  const { selectedProject } = useProjectManagementContext();

  const connectionId = useMemo((): string | null => {
    if (!selectedProject) return null;
    if (selectedProject.sshConnectionId) return selectedProject.sshConnectionId;

    const alias = selectedProject.name;
    if (typeof alias !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(alias)) return null;

    // Back-compat: on macOS/Windows a /home/... path is almost certainly remote.
    const p = selectedProject.path || '';
    const looksRemoteByPath =
      platform === 'darwin' || platform === 'win32' ? p.startsWith('/home/') : false;

    if (selectedProject.isRemote || looksRemoteByPath) {
      return `ssh-config:${encodeURIComponent(alias)}`;
    }
    return null;
  }, [selectedProject, platform]);

  const remotePath = useMemo((): string | null => {
    if (!selectedProject) return null;
    if (selectedProject.remotePath) return selectedProject.remotePath;
    if (connectionId) return selectedProject.path;
    return selectedProject.isRemote ? selectedProject.path : null;
  }, [selectedProject, connectionId]);

  return { connectionId, remotePath };
}
