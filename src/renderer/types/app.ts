import type { Task as ChatTask } from './chat';
export type Task = ChatTask & { agentId?: string };

export interface Project {
  id: string;
  name: string;
  path: string;
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
  // Internal DB field name kept as 'workspaces' for compatibility
  workspaces?: Task[];
}

// Lightweight shapes for palette/list UIs, if needed later
export type ProjectSummary = Pick<Project, 'id' | 'name'> & {
  workspaces?: Pick<Task, 'id' | 'name'>[];
};
export type TaskSummary = Pick<Task, 'id' | 'name'>;
