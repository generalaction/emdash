import { CreateConversationParams } from '@shared/conversations';

export type TaskLifecycleStatus = 'todo' | 'in_progress' | 'review' | 'done' | 'archived';

export type Issue = {
  provider: 'github' | 'linear' | 'jira';
  url: string;
  title: string;
  identifier: string;
  description?: string;
  status?: string;
  assignees?: string[];
  project?: string;
  updatedAt?: string;
  fetchedAt?: string;
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

export type TaskBootstrapStatus =
  | { status: 'ready' }
  | { status: 'bootstrapping' }
  | { status: 'error'; message: string }
  | { status: 'not-started' };

export type CreateTaskParams = {
  id: string;
  projectId: string;
  name: string;
  /** The branch to fork the new worktree from */
  sourceBranch: { branch: string; remote: string };
  /** If available, create a new git branch before the worktree */
  taskBranch?: string;
  /** If true, checkout the source branch in a worktree without creating a new branch */
  checkoutInWorktree?: boolean;
  /** The issue to link to the task */
  linkedIssue?: Issue;
  /** If true, push the task branch to the remote immediately after creation */
  pushBranch?: boolean;
  /**  */
  initialConversation?: CreateConversationParams;
};

export function formatIssueAsPrompt(issue: Issue, initialPrompt?: string): string {
  const parts = [`[${issue.identifier}] ${issue.title}`, issue.url, issue.description].filter(
    Boolean
  );

  if (initialPrompt?.trim()) parts.push('', initialPrompt.trim());
  return parts.join('\n');
}
