export type LocalProject = {
  type: 'local';
  id: string;
  name: string;
  path: string;
  baseRef: string;
  gitRemote?: string;
  createdAt: string;
  updatedAt: string;
};

export type SshProject = {
  type: 'ssh';
  id: string;
  name: string;
  path: string;
  baseRef: string;
  gitRemote?: string;
  connectionId: string;
  createdAt: string;
  updatedAt: string;
};
