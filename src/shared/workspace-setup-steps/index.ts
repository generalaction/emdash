import type * as AddWorktree from './add-worktree';
import type * as CopyPreservedFiles from './copy-preserved-files';
import type * as CreateLocalBranch from './create-local-branch';
import type * as EnsureRemote from './ensure-remote';
import type * as GitFetch from './git-fetch';
import type * as PushBranch from './push-branch';
import type * as SetBranchBase from './set-branch-base';
import type * as SetBranchTracking from './set-branch-tracking';

export type {
  AddWorktree,
  CopyPreservedFiles,
  CreateLocalBranch,
  EnsureRemote,
  GitFetch,
  PushBranch,
  SetBranchBase,
  SetBranchTracking,
};

/** Discriminated union of all workspace setup steps (args embedded). */
export type WorkspaceSetupStep =
  | { kind: 'git-fetch'; args: GitFetch.Args }
  | { kind: 'ensure-remote'; args: EnsureRemote.Args }
  | { kind: 'create-local-branch'; args: CreateLocalBranch.Args }
  | { kind: 'set-branch-tracking'; args: SetBranchTracking.Args }
  | { kind: 'set-branch-base'; args: SetBranchBase.Args }
  | { kind: 'push-branch'; args: PushBranch.Args }
  | { kind: 'add-worktree'; args: AddWorktree.Args }
  | { kind: 'copy-preserved-files'; args: CopyPreservedFiles.Args };

/** Discriminated union of all fatal step errors. */
export type SetupStepError =
  | (GitFetch.Error & { kind: 'git-fetch' })
  | (EnsureRemote.Error & { kind: 'ensure-remote' })
  | (CreateLocalBranch.Error & { kind: 'create-local-branch' })
  | (AddWorktree.Error & { kind: 'add-worktree' });

/** Discriminated union of all non-fatal step warnings. */
export type SetupStepWarning =
  | (SetBranchTracking.Warning & { kind: 'set-branch-tracking' })
  | (SetBranchBase.Warning & { kind: 'set-branch-base' })
  | (PushBranch.Warning & { kind: 'push-branch' })
  | (CopyPreservedFiles.Warning & { kind: 'copy-preserved-files' });
