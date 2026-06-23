import type {
  CommitError,
  GitCommandError,
  GitRepoSnapshot,
  GitSequences,
  GitWorktreeSnapshot,
} from '@emdash/core/git';
import type { Result } from '@emdash/shared';

export type GitRepositoryNotFoundError = { type: 'not_found' };
export type GitRepositorySnapshotError = GitRepositoryNotFoundError | GitCommandError;
export type GitRepositorySnapshotResult = Result<GitRepoSnapshot, GitRepositorySnapshotError>;

export type GitDefaultBranchResult = Result<
  { defaultBranch: string },
  GitRepositoryNotFoundError | GitCommandError
>;

export type GitWorktreeNotFoundError = { type: 'not_found' };
export type GitWorktreeSnapshotError = GitWorktreeNotFoundError | GitCommandError;
export type GitWorktreeMutationError = GitWorktreeNotFoundError | GitCommandError;
export type GitWorktreeSnapshotResult = Result<GitWorktreeSnapshot, GitWorktreeSnapshotError>;

export type GitWorktreeMutationData = {
  sequences: GitSequences;
};

export type GitWorktreeMutationResult = Result<GitWorktreeMutationData, GitWorktreeMutationError>;

export type GitWorktreeCommitData = {
  hash: string;
  sequences: GitSequences;
};

export type GitWorktreeCommitError = GitWorktreeNotFoundError | CommitError;

export type GitWorktreeCommitResult = Result<GitWorktreeCommitData, GitWorktreeCommitError>;
