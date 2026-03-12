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
  projectId: string;
  status: TaskLifecycleStatus;
  sourceBranch: string;
  taskBranch?: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  linkedIssue?: Issue;
};
