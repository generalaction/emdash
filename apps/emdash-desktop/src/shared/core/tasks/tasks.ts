import z from 'zod';
import type { Conversation } from '@shared/core/conversations/conversations';
import type {
  Branch,
  CreateBranchError,
  FetchPrForReviewError,
  PushError,
} from '@shared/core/git/git';
import type { LinkedIssue } from '@shared/core/linked-issue';
import type { PullRequest } from '@shared/core/pull-requests/pull-requests';
import type { TaskConfig } from '@shared/core/tasks/task-config';
import type { WorkspaceConfig } from '@shared/core/workspaces/workspace-config';

// ---------------------------------------------------------------------------
// Workspace intent types — stored on the task row as JSON in `workspace_intent`
// ---------------------------------------------------------------------------

/**
 * Describes the git operations to perform when setting up a workspace.
 * Stored in `tasks.workspace_intent` as part of a `WorkspaceIntent` JSON blob.
 */
export type GitSetup =
  | { kind: 'none' }
  | { kind: 'use-branch'; branchName: string }
  | { kind: 'create-branch'; branchName: string; fromBranch: Branch; pushBranch?: boolean }
  | {
      kind: 'pr-branch';
      prNumber: number;
      headBranch: string;
      headRepositoryUrl: string;
      isFork: boolean;
      /** When set, a new branch is created on top of the PR head for the task. */
      taskBranch?: string;
      pushBranch?: boolean;
    };

/**
 * Describes the physical location of a workspace.
 * `path` is set when reusing an existing directory; omitted when a new worktree
 * must be created.
 */
export type WorkspaceLocation =
  | { host: 'local'; path?: string }
  | { host: 'project-ssh'; path?: string }
  | { host: 'byoi'; remoteWorkspaceId?: string };

export const taskLifecycleStatuses = z.enum([
  'todo',
  'in_progress',
  'review',
  'done',
  'cancelled',
  'backlog',
  'duplicate',
  'triage',
]);

export type TaskLifecycleStatus = z.infer<typeof taskLifecycleStatuses>;

export type Task = {
  id: string;
  projectId: string;
  name: string;
  status: TaskLifecycleStatus;
  createdAt: string;
  updatedAt: string;
  /** ISO timestamp: when lifecycle status last changed (current status entered). */
  statusChangedAt: string;
  archivedAt?: string;
  lastInteractedAt?: string;
  linkedIssue?: LinkedIssue;
  isPinned: boolean;
  prs: PullRequest[];
  conversations: Record<string, number>;
  workspaceGit?: { linesAdded: number; linesDeleted: number };
  workspaceId?: string;
  type: 'task' | 'automation-run';
  automationRunId?: string;
};

export type TaskBootstrapStatus =
  | { status: 'ready' }
  | { status: 'bootstrapping' }
  | { status: 'error'; message: string }
  | { status: 'not-started' };

export type CreateTaskParams = {
  id: string;
  projectId: string;
  /** Typed, versioned task configuration (name, issue link, conversation, status). */
  taskConfig: TaskConfig;
  /** Typed, versioned workspace configuration (git setup + workspace location). */
  workspaceConfig: WorkspaceConfig;
  /** Set when the task is created by an automation run; stored on the task row for audit trail. */
  automationRunId?: string;
};

export type CreateTaskError =
  | { type: 'project-not-found' }
  | { type: 'initial-commit-required'; branch: string }
  | { type: 'branch-create-failed'; branch: string; error: CreateBranchError }
  | { type: 'pr-fetch-failed'; error: FetchPrForReviewError; remote: string }
  | { type: 'branch-not-found'; branch: string }
  | { type: 'worktree-setup-failed'; branch: string; message?: string }
  | { type: 'provision-failed'; message: string }
  | { type: 'provision-timeout'; timeoutMs: number; step?: string };

export type CreateTaskWarning = {
  type: 'branch-publish-failed';
  branch: string;
  remote: string;
  error: PushError;
};

export type CreateTaskSuccess = {
  task: Task;
  initialConversation?: Conversation;
  warning?: CreateTaskWarning;
};

export type RenameTaskError = { type: 'task-not-found'; taskId: string };

export type RenameTaskSuccess = {
  task: Task;
};

export type ProvisionTaskResult = {
  path: string;
  workspaceId: string;
};

export type ProvisionWorkspaceError =
  | { type: 'no-intent' }
  | { type: 'setup-failed'; stepKind: string; stepErrorType: string; message?: string };

export type DeleteTaskOptions = {
  deleteWorktree?: boolean;
  deleteBranch?: boolean;
};

export type TaskDeletePreflightItem = {
  taskId: string;
  /** taskBranch exists and no sibling task shares it */
  hasWorktree: boolean;
  /** staged or unstaged changes exist in the worktree */
  hasUncommittedChanges: boolean;
  /** hasWorktree && taskBranch differs from sourceBranch */
  hasDeletableBranch: boolean;
};

export type DeletePreflightResult = {
  tasks: TaskDeletePreflightItem[];
};
