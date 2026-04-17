export interface Project {
  id: string;
  name: string;
  path: string;
  isRemote?: boolean;
  sshConnectionId?: string | null;
  remotePath?: string | null;
  gitInfo: {
    isGitRepo: boolean;
    remote?: string;
    branch?: string;
    baseRef?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  projectId: string;
  name: string;
  branch: string;
  path: string;
  status: 'active' | 'idle' | 'running';
  agentId?: string | null;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SshConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
}
