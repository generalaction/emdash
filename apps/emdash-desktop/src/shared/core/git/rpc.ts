import type {
  CommitError,
  GitRepoSnapshot,
  GitSequences,
  GitWorktreeSnapshot,
} from '@emdash/core/git';
import type { Result } from '@emdash/shared';

export type GitRepositoryNotFoundError = { type: 'not_found' };
export type GitRepositoryGitError = { type: 'git_error'; message: string };
export type GitRepositorySnapshotError = GitRepositoryNotFoundError | GitRepositoryGitError;
export type GitRepositorySnapshotResult = Result<GitRepoSnapshot, GitRepositorySnapshotError>;

export type GitDefaultBranchResult = Result<
  { defaultBranch: string },
  GitRepositoryNotFoundError | GitRepositoryGitError
>;

export type GitWorktreeNotFoundError = { type: 'not_found' };
export type GitWorktreeGitError = { type: 'git_error'; message: string };
export type GitWorktreeSnapshotError = GitWorktreeNotFoundError | GitWorktreeGitError;
export type GitWorktreeMutationError = GitWorktreeNotFoundError | GitWorktreeGitError;
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
