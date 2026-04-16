export type ProjectBootstrapStatus =
  | { status: 'ready' }
  | { status: 'bootstrapping' }
  | { status: 'error'; message: string }
  | { status: 'not-started' };

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
