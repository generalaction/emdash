import type { CommitError, GitSequences } from '@emdash/shared/git';
import type { Result } from '@shared/lib/result';

export type GitRepositoryNotFoundError = { type: 'not_found' };
export type GitRepositoryGitError = { type: 'git_error'; message: string };

export type GitDefaultBranchResult = Result<
  { defaultBranch: string },
  GitRepositoryNotFoundError | GitRepositoryGitError
>;

export type GitWorktreeNotFoundError = { type: 'not_found' };
export type GitWorktreeGitError = { type: 'git_error'; message: string };
export type GitWorktreeMutationError = GitWorktreeNotFoundError | GitWorktreeGitError;

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
