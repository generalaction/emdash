import { ExecError } from '../exec';

export type GitCommandError = {
  type: 'git_error';
  message: string;
  stderr?: string;
};

export type CloneRepositoryError =
  | { type: 'target_exists'; path: string; message: string }
  | { type: 'auth_failed'; message: string }
  | { type: 'remote_not_found'; message: string }
  | GitCommandError;

export type FetchError =
  | { type: 'no_remote'; message?: string }
  | { type: 'remote_not_found'; remote?: string; message: string }
  | { type: 'auth_failed'; message: string }
  | { type: 'network_error'; message: string }
  | GitCommandError;

export type CommitError =
  | { type: 'nothing_to_commit'; message: string }
  | { type: 'empty_message'; message: string }
  | { type: 'hook_failed'; message: string }
  | GitCommandError;

export type PushError =
  | { type: 'no_remote'; message?: string }
  | { type: 'no_upstream'; message: string }
  | { type: 'rejected'; message: string }
  | { type: 'auth_failed'; message: string }
  | { type: 'network_error'; message: string }
  | { type: 'hook_rejected'; message: string }
  | GitCommandError;

export type PullError =
  | { type: 'conflict'; message: string; conflictedFiles?: string[] }
  | { type: 'no_upstream'; message: string }
  | { type: 'diverged'; message: string }
  | { type: 'auth_failed'; message: string }
  | { type: 'network_error'; message: string }
  | GitCommandError;

export type CreateBranchError =
  | { type: 'already_exists'; branch: string; message: string }
  | { type: 'invalid_name'; branch: string; message: string }
  | { type: 'invalid_base'; branch: string; from: string; message: string }
  | { type: 'fetch_failed'; remote: string; branch: string; error: FetchError }
  | GitCommandError;

export type FetchPrForReviewError =
  | { type: 'not_found'; prNumber: number; message: string }
  | GitCommandError;

export type DeleteBranchError =
  | { type: 'not_found'; branch: string; message: string }
  | { type: 'not_merged'; branch: string; message: string }
  | { type: 'is_current'; branch: string; message: string }
  | GitCommandError;

function errorStringProperty(error: unknown, property: 'stdout' | 'stderr' | 'message'): string {
  if (!error || typeof error !== 'object' || !(property in error)) return '';
  return String((error as Record<typeof property, unknown>)[property] ?? '').trim();
}

export function gitErrorMessage(error: unknown): string {
  if (error instanceof ExecError) {
    return error.stderr.trim() || error.stdout.trim() || error.message;
  }
  const stderr = errorStringProperty(error, 'stderr');
  const stdout = errorStringProperty(error, 'stdout');
  const message = errorStringProperty(error, 'message');
  if (stderr || stdout || message) return stderr || stdout || message;
  return error instanceof Error ? error.message : String(error);
}

export function toGitCommandError(error: unknown): GitCommandError {
  return {
    type: 'git_error',
    message: gitErrorMessage(error),
    stderr:
      error instanceof ExecError ? error.stderr : errorStringProperty(error, 'stderr') || undefined,
  };
}

export function classifyCloneRepositoryError(
  error: unknown,
  targetPath: string
): CloneRepositoryError {
  const commandError = toGitCommandError(error);
  const message = commandError.message.toLowerCase();
  if (
    message.includes('already exists and is not an empty directory') ||
    (message.includes('destination path') && message.includes('already exists'))
  ) {
    return { type: 'target_exists', path: targetPath, message: commandError.message };
  }
  if (message.includes('authentication') || message.includes('permission denied')) {
    return { type: 'auth_failed', message: commandError.message };
  }
  if (
    message.includes('repository not found') ||
    message.includes('does not appear to be a git repository') ||
    message.includes('not found')
  ) {
    return { type: 'remote_not_found', message: commandError.message };
  }
  return commandError;
}

export function classifyFetchError(error: unknown, remote: string | undefined): FetchError {
  const commandError = toGitCommandError(error);
  const message = commandError.message.toLowerCase();
  if (
    message.includes('no remote repository specified') ||
    message.includes('no remote configured')
  ) {
    return { type: 'no_remote', message: commandError.message };
  }
  if (message.includes('authentication') || message.includes('permission denied')) {
    return { type: 'auth_failed', message: commandError.message };
  }
  if (
    message.includes('could not resolve host') ||
    message.includes('network is unreachable') ||
    message.includes('connection refused') ||
    message.includes('connection timed out') ||
    message.includes('no route to host') ||
    message.includes('network is down') ||
    message.includes('could not resolve hostname') ||
    message.includes('temporary failure in name resolution') ||
    message.includes('name or service not known') ||
    message.includes('ssh: connect to host') ||
    message.includes('unable to connect')
  ) {
    return { type: 'network_error', message: commandError.message };
  }
  if (message.includes('does not appear to be a git repository') || message.includes('not found')) {
    return { type: 'remote_not_found', remote, message: commandError.message };
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
    return { type: 'not_found', prNumber, message: commandError.message };
  }
  return commandError;
}

export function classifyCommitError(error: unknown): CommitError {
  const commandError = toGitCommandError(error);
  const message = commandError.message.toLowerCase();
  if (message.includes('nothing to commit')) {
    return { type: 'nothing_to_commit', message: commandError.message };
  }
  if (message.includes('empty commit message')) {
    return { type: 'empty_message', message: commandError.message };
  }
  if (message.includes('hook')) {
    return { type: 'hook_failed', message: commandError.message };
  }
  return commandError;
}

export function classifyPushError(error: unknown): PushError {
  const commandError = toGitCommandError(error);
  const message = commandError.message.toLowerCase();
  if (message.includes('no upstream')) {
    return { type: 'no_upstream', message: commandError.message };
  }
  if (
    message.includes('no configured push destination') ||
    message.includes('no remote configured') ||
    message.includes('no remote')
  ) {
    return { type: 'no_remote', message: commandError.message };
  }
  if (message.includes('rejected') || message.includes('non-fast-forward')) {
    return { type: 'rejected', message: commandError.message };
  }
  if (message.includes('authentication') || message.includes('permission denied')) {
    return { type: 'auth_failed', message: commandError.message };
  }
  if (
    message.includes('could not resolve host') ||
    message.includes('network is unreachable') ||
    message.includes('connection refused') ||
    message.includes('connection timed out') ||
    message.includes('unable to connect')
  ) {
    return { type: 'network_error', message: commandError.message };
  }
  if (message.includes('hook declined') || message.includes('pre-receive hook')) {
    return { type: 'hook_rejected', message: commandError.message };
  }
  return commandError;
}

export function classifyPullError(error: unknown): PullError {
  const commandError = toGitCommandError(error);
  const message = commandError.message.toLowerCase();
  if (message.includes('conflict')) return { type: 'conflict', message: commandError.message };
  if (
    message.includes('there is no tracking information') ||
    message.includes('no tracking information') ||
    message.includes('has no upstream branch') ||
    message.includes('no upstream configured')
  ) {
    return { type: 'no_upstream', message: commandError.message };
  }
  if (
    message.includes('need to specify how to reconcile') ||
    message.includes('you have divergent branches')
  ) {
    return { type: 'diverged', message: commandError.message };
  }
  if (message.includes('authentication') || message.includes('permission denied')) {
    return { type: 'auth_failed', message: commandError.message };
  }
  if (
    message.includes('could not resolve host') ||
    message.includes('network is unreachable') ||
    message.includes('connection refused') ||
    message.includes('connection timed out') ||
    message.includes('unable to connect')
  ) {
    return { type: 'network_error', message: commandError.message };
  }
  return commandError;
}

export function classifyCreateBranchError(
  error: unknown,
  branch: string,
  from: string
): CreateBranchError {
  const commandError = toGitCommandError(error);
  const stderr = commandError.stderr ?? commandError.message;
  if (stderr.includes('already exists')) {
    return { type: 'already_exists', branch, message: commandError.message };
  }
  if (
    stderr.includes('not a valid object name') ||
    stderr.includes('Not a valid object name') ||
    stderr.includes('invalid reference')
  ) {
    return { type: 'invalid_base', branch, from, message: commandError.message };
  }
  if (stderr.includes('not a valid branch name')) {
    return { type: 'invalid_name', branch, message: commandError.message };
  }
  return commandError;
}

export function classifyDeleteBranchError(error: unknown, branch: string): DeleteBranchError {
  const commandError = toGitCommandError(error);
  const stderr = (commandError.stderr ?? commandError.message).toLowerCase();
  if (
    stderr.includes('checked out') ||
    stderr.includes('currently checked out') ||
    stderr.includes('cannot delete branch')
  ) {
    return { type: 'is_current', branch, message: commandError.message };
  }
  if (stderr.includes('not found')) {
    return { type: 'not_found', branch, message: commandError.message };
  }
  if (stderr.includes('not fully merged')) {
    return { type: 'not_merged', branch, message: commandError.message };
  }
  return commandError;
}
