export type LocalProject = {
  type: 'local';
  id: string;
  name: string;
  path: string;
  baseRef: string; // always has a value — not optional
  gitRemote?: string;
  gitBranch?: string;
  github?: {
    // grouped: either both fields exist, or neither
    repository: string;
    connected: boolean;
  };
  createdAt: string;
  updatedAt: string;
};
