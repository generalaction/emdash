export type ProjectBootstrapStatus =
  | { status: 'ready' }
  | { status: 'bootstrapping' }
  | { status: 'error'; message: string }
  | { status: 'not-started' };

export type ProjectPathStatus = {
  isDirectory: boolean;
  isGitRepo: boolean;
};

export type ProjectAppearance = {
  icon: string | null;
  iconColor: string | null;
};

export type LocalProject = {
  type: 'local';
  id: string;
  name: string;
  path: string;
  baseRef: string;
  archived: boolean;
  icon: string | null;
  iconColor: string | null;
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
  archived: boolean;
  icon: string | null;
  iconColor: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Project = LocalProject | SshProject;

export type OpenProjectError =
  | { type: 'path-not-found'; path: string }
  | { type: 'ssh-disconnected'; connectionId: string }
  | { type: 'error'; message: string };

export type UpdateProjectSettingsError =
  | { type: 'project-not-found' }
  | { type: 'invalid-settings' }
  | { type: 'invalid-worktree-directory' }
  | { type: 'error' };

export type ProjectRemoteState = {
  hasRemote: boolean;
  selectedRemoteUrl: string | null;
};
