export type TaskLifecycleStatus = 'todo' | 'in_progress' | 'review' | 'done' | 'archived';

export type Issue = {
  provider: 'github' | 'linear' | 'jira';
  url: string;
  title: string;
  identifier: string;
  description?: string;
  updatedAt?: string;
};

export type Task = {
  id: string;
  status: TaskLifecycleStatus;
  projectId: string;
  branch?: string; // if the task has a branch, we should use worktrees
  worktreePath?: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  linkedIssue?: Issue;
};
