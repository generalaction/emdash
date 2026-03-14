import { CreateConversationParams } from '@shared/conversations';

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
  name: string;
  status: TaskLifecycleStatus;
  sourceBranch: string;
  taskBranch?: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  linkedIssue?: Issue;
};

export type CreateTaskParams = {
  id?: string;
  projectId: string;
  name: string;
  /** The branch to fork the new worktree from */
  sourceBranch: string;
  /** If available, create a new git branch before the worktree */
  taskBranch?: string;
  /** The issue to link to the task */
  linkedIssue?: Issue;
  /**  */
  initialConversation?: CreateConversationParams;
};
