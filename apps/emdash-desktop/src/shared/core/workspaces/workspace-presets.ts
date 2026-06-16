import type { GitBranchRef } from '@emdash/shared/git';
import type { PullRequest } from '@shared/core/pull-requests/pull-requests';

// ---------------------------------------------------------------------------
// Preset IDs
// ---------------------------------------------------------------------------

export type WorkspacePresetId =
  | 'new-worktree'
  | 'checkout-pr'
  | 'pr-new-branch'
  | 'use-existing'
  | 'repo-root'
  | 'sandbox';

// ---------------------------------------------------------------------------
// Preset metadata — static catalogue, no build logic
// ---------------------------------------------------------------------------

export type WorkspacePresetMeta = {
  id: WorkspacePresetId;
  label: string;
  description: string;
  /** Only show this preset when a PR is linked in the creation context. */
  requiresPR: boolean;
  /** Only show this preset when the BYOI workspace-provider feature flag is enabled. */
  requiresBYOI: boolean;
};

export const WORKSPACE_PRESETS: WorkspacePresetMeta[] = [
  {
    id: 'new-worktree',
    label: 'Create new worktree',
    description: 'Create an isolated worktree on a branch',
    requiresPR: false,
    requiresBYOI: false,
  },
  {
    id: 'repo-root',
    label: 'Use the repository directory',
    description: 'Work directly in the project directory (no worktree)',
    requiresPR: false,
    requiresBYOI: false,
  },
  {
    id: 'use-existing',
    label: 'Reuse an existing workspace',
    description: 'Reuse an existing worktree or repository workspace',
    requiresPR: false,
    requiresBYOI: false,
  },
  {
    id: 'checkout-pr',
    label: 'Checkout PR in worktree',
    description: 'Fetch and review a pull request in its own worktree',
    requiresPR: true,
    requiresBYOI: false,
  },
  {
    id: 'pr-new-branch',
    label: 'Create a new branch from a PR in worktree',
    description: 'Create a new branch on top of the PR head for your changes',
    requiresPR: true,
    requiresBYOI: false,
  },
  {
    id: 'sandbox',
    label: 'Sandbox (BYOI)',
    description: 'Provision an isolated remote workspace via your infrastructure script',
    requiresPR: false,
    requiresBYOI: true,
  },
];

// ---------------------------------------------------------------------------
// Context provided at creation time to build a WorkspaceConfig
// ---------------------------------------------------------------------------

export type PresetContext = {
  /** Default branch of the project repository. */
  defaultBranch?: GitBranchRef;
  /** Current HEAD branch name on the project. */
  currentBranch?: string;
  /** Linked PR, required for checkout-pr and pr-new-branch presets. */
  pr?: PullRequest;
  /**
   * The workspace ID of the project's repository-root workspace.
   * Required for repo-root and use-existing presets.
   */
  repositoryWorkspaceId?: string;
  /**
   * An explicitly selected existing workspace ID.
   * Required for use-existing preset.
   */
  existingWorkspaceId?: string;
};

// ---------------------------------------------------------------------------
// Overrides — user-customizable fields for the selected preset
// ---------------------------------------------------------------------------

export type PresetOverrides = {
  /** New branch name (new-worktree, pr-new-branch). */
  branchName?: string;
  /** Source branch to branch from or check out (new-worktree). */
  fromBranch?: GitBranchRef;
  /** Whether to push the branch to remote after creation. */
  pushBranch?: boolean;
  /** Task-specific branch created on top of the PR head (pr-new-branch). */
  taskBranch?: string;
  /** When false, checkout fromBranch in a new worktree instead of creating a new branch (new-worktree preset). Defaults to true. */
  createBranch?: boolean;
};
