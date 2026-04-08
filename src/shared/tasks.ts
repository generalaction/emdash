import { CreateConversationParams } from '@shared/conversations';

export type TaskLifecycleStatus = 'todo' | 'in_progress' | 'review' | 'done' | 'archived';

export type Issue = {
  provider: 'github' | 'linear' | 'jira' | 'gitlab' | 'plain' | 'forgejo';
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
  lastInteractedAt?: string;
  linkedIssue?: Issue;
};

export type TaskBootstrapStatus =
  | { status: 'ready' }
  | { status: 'bootstrapping' }
  | { status: 'error'; message: string }
  | { status: 'not-started' };

/**
 * Discriminated union describing how a task's branch and worktree should be set up.
 *
 * - `new-branch`: Create a fresh git branch from `sourceBranch`, serve an isolated worktree.
 * - `checkout-existing`: Check out `sourceBranch` directly in a worktree (branch must exist on remote).
 * - `from-pull-request`: Fetch via `refs/pull/<prNumber>/head` — works for fork PRs. Optionally
 *   create a new task branch on top of the fetched head.
 * - `no-worktree`: No branch creation, no worktree — task runs in the project root directory.
 */
export type CreateTaskStrategy =
  | { kind: 'new-branch'; taskBranch: string; pushBranch?: boolean }
  | { kind: 'checkout-existing' }
  | {
      kind: 'from-pull-request';
      prNumber: number;
      headBranch: string;
      taskBranch?: string;
      pushBranch?: boolean;
    }
  | { kind: 'no-worktree' };

export type CreateTaskParams = {
  id: string;
  projectId: string;
  name: string;
  /** The branch to fork the new worktree from (not used for `from-pull-request` strategy) */
  sourceBranch: { branch: string; remote?: string };
  /** Controls branch creation, worktree setup, and git fetch strategy */
  strategy: CreateTaskStrategy;
  /** The issue to link to the task */
  linkedIssue?: Issue;
  /**  */
  initialConversation?: CreateConversationParams;
};

export type CreateTaskError =
  | { type: 'project-not-found' }
  | { type: 'branch-not-found'; branch: string }
  | { type: 'branch-already-exists'; branch: string }
  | { type: 'invalid-base-branch'; branch: string }
  | { type: 'worktree-setup-failed'; message: string }
  | { type: 'pr-fetch-failed'; message: string }
  | { type: 'provision-failed'; message: string };

export type ProvisionTaskResult = {
  path: string;
  workspaceId: string;
};

export function formatIssueAsPrompt(issue: Issue, initialPrompt?: string): string {
  const parts = [`[${issue.identifier}] ${issue.title}`, issue.url, issue.description].filter(
    Boolean
  );

  if (initialPrompt?.trim()) parts.push('', initialPrompt.trim());
  return parts.join('\n');
}
