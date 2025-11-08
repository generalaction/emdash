import type { Workspace as ChatWorkspace } from './chat';
export type Workspace = ChatWorkspace & { agentId?: string };

export interface Project {
  id: string;
  name: string;
  path: string;
  repoKey?: string;
  gitInfo: {
    isGitRepo: boolean;
    remote?: string;
    branch?: string;
  };
  githubInfo?: {
    repository: string;
    connected: boolean;
  };
  workspaces?: Workspace[];
}

// Lightweight shapes for palette/list UIs, if needed later
export type ProjectSummary = Pick<Project, 'id' | 'name'> & { workspaces?: Pick<Workspace, 'id' | 'name'>[] };
export type WorkspaceSummary = Pick<Workspace, 'id' | 'name'>;
