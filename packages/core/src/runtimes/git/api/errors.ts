import { err, type Err } from '@emdash/shared';
import type { HostAbsolutePath, PortableRelativePath } from '@primitives/path/api';
import type {
  CreateBranchError,
  DeleteBranchError,
  FetchError,
  FetchPrForReviewError,
  GitExecError,
  GitOperationError,
  GitResolutionError,
  SwitchError,
} from '@runtimes/git/api/api/errors';

type TaggedError<Type extends GitOperationError['type']> = Extract<
  GitOperationError,
  { type: Type }
>;

const failure = <E>(error: E): Err<E> => err(error);

/** Constructors for declared Git domain failures. */
export const gitErr = {
  commandFailed(message: string, stderr?: string): Err<GitExecError> {
    return failure({ type: 'git_error', message, ...(stderr ? { stderr } : {}) });
  },
  resolutionFailed(path: HostAbsolutePath, message: string): Err<GitResolutionError> {
    return failure({ type: 'resolution_failed', path, message });
  },
  targetExists(path: HostAbsolutePath, message: string): Err<TaggedError<'target_exists'>> {
    return failure({ type: 'target_exists', path, message });
  },
  authRequired(message: string): Err<TaggedError<'auth_required'>> {
    return failure({ type: 'auth_required', message });
  },
  authFailed(message: string): Err<TaggedError<'auth_failed'>> {
    return failure({ type: 'auth_failed', message });
  },
  remoteNotFound(message: string, remote?: string): Err<TaggedError<'remote_not_found'>> {
    return failure({ type: 'remote_not_found', message, ...(remote ? { remote } : {}) });
  },
  noRemote(message?: string): Err<TaggedError<'no_remote'>> {
    return failure({ type: 'no_remote', ...(message ? { message } : {}) });
  },
  networkError(message: string): Err<TaggedError<'network_error'>> {
    return failure({ type: 'network_error', message });
  },
  nothingToCommit(message: string): Err<TaggedError<'nothing_to_commit'>> {
    return failure({ type: 'nothing_to_commit', message });
  },
  emptyMessage(message: string): Err<TaggedError<'empty_message'>> {
    return failure({ type: 'empty_message', message });
  },
  hookFailed(message: string): Err<TaggedError<'hook_failed'>> {
    return failure({ type: 'hook_failed', message });
  },
  noUpstream(message: string): Err<TaggedError<'no_upstream'>> {
    return failure({ type: 'no_upstream', message });
  },
  rejected(message: string): Err<TaggedError<'rejected'>> {
    return failure({ type: 'rejected', message });
  },
  hookRejected(message: string): Err<TaggedError<'hook_rejected'>> {
    return failure({ type: 'hook_rejected', message });
  },
  conflict(
    message: string,
    conflictedFiles?: PortableRelativePath[]
  ): Err<TaggedError<'conflict'>> {
    return failure({ type: 'conflict', message, conflictedFiles });
  },
  diverged(message: string): Err<TaggedError<'diverged'>> {
    return failure({ type: 'diverged', message });
  },
  alreadyExists(branch: string, message: string): Err<TaggedError<'already_exists'>> {
    return failure({ type: 'already_exists', branch, message });
  },
  invalidName(branch: string, message: string): Err<TaggedError<'invalid_name'>> {
    return failure({ type: 'invalid_name', branch, message });
  },
  invalidBase(branch: string, from: string, message: string): Err<TaggedError<'invalid_base'>> {
    return failure({ type: 'invalid_base', branch, from, message });
  },
  fetchFailed(remote: string, branch: string, error: FetchError): Err<CreateBranchError> {
    return failure({ type: 'fetch_failed', remote, branch, error });
  },
  prNotFound(
    prNumber: number,
    message: string
  ): Err<Extract<FetchPrForReviewError, { type: 'not_found' }>> {
    return failure({ type: 'not_found', prNumber, message });
  },
  branchNotFound(
    branch: string,
    message: string
  ): Err<Extract<DeleteBranchError, { type: 'not_found' }>> {
    return failure({ type: 'not_found', branch, message });
  },
  branchNotMerged(branch: string, message: string): Err<TaggedError<'not_merged'>> {
    return failure({ type: 'not_merged', branch, message });
  },
  branchIsCurrent(branch: string, message: string): Err<TaggedError<'is_current'>> {
    return failure({ type: 'is_current', branch, message });
  },
  alreadyUpToDate(message: string): Err<TaggedError<'already_up_to_date'>> {
    return failure({ type: 'already_up_to_date', message });
  },
  nothingToRebase(message: string): Err<TaggedError<'nothing_to_rebase'>> {
    return failure({ type: 'nothing_to_rebase', message });
  },
  localChanges(message: string): Err<TaggedError<'local_changes'>> {
    return failure({ type: 'local_changes', message });
  },
  refNotFound(ref: string, message: string): Err<Extract<SwitchError, { type: 'not_found' }>> {
    return failure({ type: 'not_found', ref, message });
  },
  notRepository(path: HostAbsolutePath): Err<TaggedError<'not-repository'>> {
    return failure({ type: 'not-repository', path });
  },
  inspectFailed(path: HostAbsolutePath, message: string): Err<TaggedError<'inspect-failed'>> {
    return failure({ type: 'inspect-failed', path, message });
  },
  initFailed(path: HostAbsolutePath, message: string): Err<TaggedError<'init-failed'>> {
    return failure({ type: 'init-failed', path, message });
  },
} as const;
