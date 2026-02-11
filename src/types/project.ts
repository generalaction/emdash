/**
 * Remote Project Configuration
 * Extends a local project with remote SSH connection details
 */
export interface RemoteProjectConfig {
  sshConnectionId: string;
  remotePath: string;
}

/**
 * Project Type
 * Determines whether a project is local-only or remote-connected
 */
export type ProjectType = 'local' | 'remote';
