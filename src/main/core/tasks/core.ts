export type TaskStatus = 'active' | 'idle' | 'running';

export type TaskLifecycleStatus =
  | 'todo'
  | 'in_progress'
  | 'pr_open'
  | 'pr_merged'
  | 'done'
  | 'archived';

export type LinkedIssue =
  | { source: 'github'; number: number; title: string; url?: string; body?: string }
  | { source: 'linear'; identifier: string; title: string; url?: string; description?: string }
  | { source: 'jira'; key: string; summary: string; url?: string };

export type TaskPr = {
  number: number;
  url: string;
  state: 'open' | 'merged' | 'closed';
};

export type Task = {
  id: string; // stable hash derived from the worktree path
  projectId: string;
  name: string;
  path: string;
  status: TaskLifecycleStatus;
  sourceBranch: string;
  linkedIssue?: LinkedIssue;
  pr?: TaskPr;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
  initialConversation: {
    agentId: string;
    initialPrompt: string;
  };
};

export type TaskMetadata = {
  lifecycleStatus: TaskLifecycleStatus;
  linkedIssue?: LinkedIssue;
  sourceBranch?: string;
  initialPrompt?: string;
};
