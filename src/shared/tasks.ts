import type { CreateConversationParams } from '@shared/conversations';
import type { Branch, CreateBranchError, FetchPrForReviewError, PushError } from '@shared/git';
import type { PullRequest } from '@shared/pull-requests';

export type TaskLifecycleStatus = 'todo' | 'in_progress' | 'review' | 'done' | 'cancelled';

export type Issue = {
  provider: 'github' | 'linear' | 'jira' | 'gitlab' | 'plain' | 'forgejo';
  url: string;
  title: string;
  identifier: string;
  description?: string;
  branchName?: string;
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
  sourceBranch: Branch | undefined;
  taskBranch?: string;
  createdAt: string;
  updatedAt: string;
  /** ISO timestamp: when lifecycle status last changed (current status entered). */
  statusChangedAt: string;
  archivedAt?: string;
  lastInteractedAt?: string;
  linkedIssue?: Issue;
  isPinned: boolean;
  prs: PullRequest[];
  conversations: Record<string, number>;
};

export type TaskBootstrapStatus =
  | { status: 'ready' }
  | { status: 'bootstrapping' }
  | { status: 'error'; message: string }
  | { status: 'not-started' };

export type CreateTaskStrategy =
  | {
      kind: 'new-branch';
      taskBranch: string;
      pushBranch?: boolean;
      pullFreshFromSource?: boolean;
    }
  | { kind: 'checkout-existing' }
  | {
      kind: 'from-pull-request';
      prNumber: number;
      /** The PR's headRefName, used as the local branch name (same as `gh pr checkout`). */
      headBranch: string;
      headRepositoryUrl: string;
      isFork: boolean;
      taskBranch?: string;
      pushBranch?: boolean;
    }
  | { kind: 'no-worktree' };

export type CreateTaskParams = {
  id: string;
  projectId: string;
  name: string;
  /** The branch to fork the new worktree from (not used for `from-pull-request` strategy) */
  sourceBranch: Branch;
  /** Controls branch creation, worktree setup, and git fetch strategy */
  strategy: CreateTaskStrategy;
  /** The issue to link to the task */
  linkedIssue?: Issue;
  /**  */
  initialConversation?: CreateConversationParams;
  initialStatus?: TaskLifecycleStatus;
};

export type CreateTaskError =
  | { type: 'project-not-found' }
  | { type: 'initial-commit-required'; branch: string }
  | { type: 'branch-create-failed'; branch: string; error: CreateBranchError }
  | { type: 'pr-fetch-failed'; error: FetchPrForReviewError; remote: string }
  | { type: 'branch-not-found'; branch: string }
  | { type: 'worktree-setup-failed'; branch: string; message?: string }
  | { type: 'provision-failed'; message: string };

export type CreateTaskWarning = {
  type: 'branch-publish-failed';
  branch: string;
  remote: string;
  error: PushError;
};

export type CreateTaskSuccess = {
  task: Task;
  warning?: CreateTaskWarning;
};

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
