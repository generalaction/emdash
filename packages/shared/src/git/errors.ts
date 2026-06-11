import { ExecError } from '../exec';

export type GitCommandError = {
  type: 'git-error';
  message: string;
  stderr?: string;
};

export type FetchError =
  | { type: 'remote-not-found'; remote?: string; message: string }
  | { type: 'auth-failed'; message: string }
  | GitCommandError;

export type CommitError =
  | { type: 'nothing-to-commit'; message: string }
  | { type: 'empty-message'; message: string }
  | GitCommandError;

export type PushError =
  | { type: 'no-upstream'; message: string }
  | { type: 'rejected'; message: string }
  | { type: 'auth-failed'; message: string }
  | GitCommandError;

export type PullError =
  | { type: 'conflict'; message: string }
  | { type: 'auth-failed'; message: string }
  | GitCommandError;

export type CreateBranchError =
  | { type: 'already-exists'; branch: string; message: string }
  | { type: 'invalid-name'; branch: string; message: string }
  | { type: 'invalid-base'; branch: string; from: string; message: string }
  | { type: 'fetch-failed'; remote: string; branch: string; error: FetchError }
  | GitCommandError;

export type FetchPrForReviewError =
  | { type: 'not-found'; prNumber: number; message: string }
  | GitCommandError;

export type RenameBranchError =
  | { type: 'already-exists'; branch: string; message: string }
  | { type: 'not-found'; branch: string; message: string }
  | GitCommandError;

export type DeleteBranchError =
  | { type: 'not-found'; branch: string; message: string }
  | { type: 'not-merged'; branch: string; message: string }
  | GitCommandError;

export type SoftResetError =
  | { type: 'initial-commit'; message: string }
  | { type: 'already-pushed'; message: string }
  | GitCommandError;

export function gitErrorMessage(error: unknown): string {
  if (error instanceof ExecError) {
    return error.stderr.trim() || error.stdout.trim() || error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export function toGitCommandError(error: unknown): GitCommandError {
  return {
    type: 'git-error',
    message: gitErrorMessage(error),
    stderr: error instanceof ExecError ? error.stderr : undefined,
  };
}

export function classifyFetchError(error: unknown, remote: string | undefined): FetchError {
  const commandError = toGitCommandError(error);
  const message = commandError.message.toLowerCase();
  if (message.includes('authentication') || message.includes('permission denied')) {
    return { type: 'auth-failed', message: commandError.message };
  }
  if (message.includes('does not appear to be a git repository') || message.includes('not found')) {
    return { type: 'remote-not-found', remote, message: commandError.message };
  }
  return commandError;
}

export function classifyFetchPrForReviewError(
  error: unknown,
  prNumber: number
): FetchPrForReviewError {
  const commandError = toGitCommandError(error);
  const message = commandError.message.toLowerCase();
  if (
    message.includes('not found') ||
    message.includes("couldn't find remote ref") ||
    message.includes('unknown revision')
  ) {
    return { type: 'not-found', prNumber, message: commandError.message };
  }
  return commandError;
}

export function classifyCommitError(error: unknown): CommitError {
  const commandError = toGitCommandError(error);
  const message = commandError.message.toLowerCase();
  if (message.includes('nothing to commit')) {
    return { type: 'nothing-to-commit', message: commandError.message };
  }
  if (message.includes('empty commit message')) {
    return { type: 'empty-message', message: commandError.message };
  }
  return commandError;
}

export function classifyPushError(error: unknown): PushError {
  const commandError = toGitCommandError(error);
  const message = commandError.message.toLowerCase();
  if (message.includes('no upstream') || message.includes('no configured push destination')) {
    return { type: 'no-upstream', message: commandError.message };
  }
  if (message.includes('rejected') || message.includes('non-fast-forward')) {
    return { type: 'rejected', message: commandError.message };
  }
  if (message.includes('authentication') || message.includes('permission denied')) {
    return { type: 'auth-failed', message: commandError.message };
  }
  return commandError;
}

export function classifyPullError(error: unknown): PullError {
  const commandError = toGitCommandError(error);
  const message = commandError.message.toLowerCase();
  if (message.includes('conflict')) return { type: 'conflict', message: commandError.message };
  if (message.includes('authentication') || message.includes('permission denied')) {
    return { type: 'auth-failed', message: commandError.message };
  }
  return commandError;
}

export function classifyCreateBranchError(
  error: unknown,
  branch: string,
  from: string
): CreateBranchError {
  const commandError = toGitCommandError(error);
  const stderr = commandError.stderr ?? '';
  if (stderr.includes('already exists')) {
    return { type: 'already-exists', branch, message: commandError.message };
  }
  if (
    stderr.includes('not a valid object name') ||
    stderr.includes('Not a valid object name') ||
    stderr.includes('invalid reference')
  ) {
    return { type: 'invalid-base', branch, from, message: commandError.message };
  }
  if (stderr.includes('not a valid branch name')) {
    return { type: 'invalid-name', branch, message: commandError.message };
  }
  return commandError;
}

export function classifyRenameBranchError(
  error: unknown,
  oldBranch: string,
  newBranch: string
): RenameBranchError {
  const commandError = toGitCommandError(error);
  const stderr = commandError.stderr ?? '';
  if (stderr.includes('already exists')) {
    return { type: 'already-exists', branch: newBranch, message: commandError.message };
  }
  if (stderr.includes('No branch named')) {
    return { type: 'not-found', branch: oldBranch, message: commandError.message };
  }
  return commandError;
}

export function classifyDeleteBranchError(error: unknown, branch: string): DeleteBranchError {
  const commandError = toGitCommandError(error);
  const stderr = commandError.stderr ?? '';
  if (stderr.includes('not found')) {
    return { type: 'not-found', branch, message: commandError.message };
  }
  if (stderr.includes('not fully merged')) {
    return { type: 'not-merged', branch, message: commandError.message };
  }
  return commandError;
}

export function classifySoftResetError(error: unknown): SoftResetError {
  return toGitCommandError(error);
}
