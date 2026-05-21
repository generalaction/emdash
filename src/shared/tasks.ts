import type { CreateConversationParams } from '@shared/conversations';
import type { ProvisionStep } from '@shared/events/taskEvents';
import type { Branch, CreateBranchError, FetchPrForReviewError, PushError } from '@shared/git';
import type { PullRequest } from '@shared/pull-requests';

export type TaskLifecycleStatus = 'todo' | 'in_progress' | 'review' | 'done' | 'cancelled';

export type Issue = {
  provider: 'github' | 'linear' | 'jira' | 'gitlab' | 'plain' | 'forgejo' | 'featurebase' | 'asana';
  url: string;
  title: string;
  identifier: string;
  description?: string;
  context?: string;
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
  workspaceGit?: { linesAdded: number; linesDeleted: number };
  workspaceId?: string;
};

export type TaskBootstrapStatus =
  | { status: 'ready' }
  | { status: 'bootstrapping' }
  | { status: 'error'; message: string }
  | { status: 'not-started' };

export type CreateTaskStrategy =
  | { kind: 'new-branch'; taskBranch: string; pushBranch?: boolean }
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
  workspaceProvider?: 'byoi';
};

export type CreateTaskLimitDecision =
  | { kind: 'ok' }
  | { kind: 'soft-exceeded'; current: number; limit: number };

export type CreateTaskError =
  | { type: 'project-not-found' }
  | { type: 'initial-commit-required'; branch: string }
  | { type: 'branch-create-failed'; branch: string; error: CreateBranchError }
  | { type: 'pr-fetch-failed'; error: FetchPrForReviewError; remote: string }
  | { type: 'branch-not-found'; branch: string }
  | { type: 'worktree-setup-failed'; branch: string; message?: string }
  | { type: 'provision-failed'; message: string }
  | { type: 'provision-timeout'; timeoutMs: number; step: ProvisionStep | null };

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

export type RenameTaskError =
  | { type: 'task-not-found'; taskId: string }
  | { type: 'project-not-found'; projectId: string }
  | { type: 'branch-already-exists'; branch: string }
  | { type: 'branch-rename-failed'; branch: string; message: string };

export type RenameTaskWarning = {
  type: 'branch-remote-push-failed';
  branch: string;
  message: string;
};

export type RenameTaskSuccess = {
  warning?: RenameTaskWarning;
};

export type ProvisionTaskResult = {
  path: string;
  workspaceId: string;
};

export function formatIssueAsPrompt(issue: Issue, initialPrompt?: string): string {
  const parts = [
    `[${issue.identifier}] ${issue.title}`,
    issue.url,
    issue.description,
    issue.context,
  ].filter(Boolean);

  if (initialPrompt?.trim()) parts.push('', initialPrompt.trim());
  return parts.join('\n');
}
