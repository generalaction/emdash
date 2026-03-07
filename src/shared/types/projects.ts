export type LocalProject = {
  type: 'local';
  id: string;
  name: string;
  path: string;
  baseRef: string;
  gitRemote?: string;
  gitBranch?: string;
  github?: {
    repository: string;
    connected: boolean;
  };
  createdAt: string;
  updatedAt: string;
};
