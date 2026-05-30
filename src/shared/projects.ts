export type ProjectPathStatus = {
  isDirectory: boolean;
  isGitRepo: boolean;
};

export type LocalProject = {
  type: 'local';
  id: string;
  name: string;
  path: string;
  baseRef: string;
  createdAt: string;
  updatedAt: string;
};

export type SshProject = {
  type: 'ssh';
  id: string;
  name: string;
  path: string;
  baseRef: string;
  connectionId: string;
  createdAt: string;
  updatedAt: string;
};

export type Project = LocalProject | SshProject;

export type CreateLocalProjectParams = {
  type: 'local';
  id?: string;
  path: string;
  name: string;
  initGitRepository?: boolean;
};

export type CreateSshProjectParams = {
  type: 'ssh';
  id?: string;
  name: string;
  path: string;
  connectionId: string;
  initGitRepository?: boolean;
};

export type CreateProjectParams = CreateLocalProjectParams | CreateSshProjectParams;

export type InspectLocalProjectPathParams = {
  type: 'local';
  path: string;
};

export type InspectSshProjectPathParams = {
  type: 'ssh';
  path: string;
  connectionId: string;
};

export type InspectProjectPathParams = InspectLocalProjectPathParams | InspectSshProjectPathParams;

export type ProjectPathInspection = ProjectPathStatus & {
  existingProject?: Project;
};

export type OpenProjectError =
  | { type: 'path-not-found'; path: string }
  | { type: 'ssh-disconnected'; connectionId: string }
  | { type: 'error'; message: string };

export type UpdateProjectSettingsError =
  | { type: 'project-not-found' }
  | { type: 'invalid-settings' }
  | { type: 'invalid-worktree-directory' }
  | { type: 'write-config-failed'; message: string }
  | { type: 'error' };

export type ProjectRemoteState = {
  hasRemote: boolean;
  selectedRemoteUrl: string | null;
};

export type RepoInstance = {
  id: string;
  projectId: string;
  label: string | null;
  kind: 'local' | 'ssh' | 'byoi';
  connectionId: string | null;
  path: string | null;
  remoteUrl: string | null;
  isFork: boolean;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AddRepoInstanceParams = {
  projectId: string;
  label?: string;
  kind: 'local' | 'ssh' | 'byoi';
  connectionId?: string;
  path?: string;
  remoteUrl?: string;
  isFork?: boolean;
  /** When set, clone this URL to `path` before registering the instance. */
  cloneUrl?: string;
};

export type RemoveRepoInstanceResult = { success: true } | { success: false; error: string };
