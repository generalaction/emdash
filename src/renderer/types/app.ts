import type { Task as ChatTask } from './chat';
export type Task = ChatTask & { agentId?: string };

export interface Project {
  id: string;
  name: string;
  path: string;
  isRemote?: boolean;
  sshConnectionId?: string | null;
  remotePath?: string | null;
  repoKey?: string;
  gitInfo: {
    isGitRepo: boolean;
    remote?: string;
    branch?: string;
    baseRef?: string;
  };
  githubInfo?: {
    repository: string;
    connected: boolean;
  };
  tasks?: Task[];
}

// Lightweight shapes for palette/list UIs, if needed later
export type ProjectSummary = Pick<Project, 'id' | 'name'> & {
  tasks?: Pick<Task, 'id' | 'name'>[];
};
export type TaskSummary = Pick<Task, 'id' | 'name'>;
