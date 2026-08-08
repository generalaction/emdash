import { err, type Err } from '@emdash/shared';
import type { HostAbsolutePath, PortableRelativePath } from '#primitives/path/api';
import type {
  FetchPrForReviewError,
  GitExecError,
  GitOperationError,
  GitResolutionError,
} from '#runtimes/git/api/api/errors';

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
  staleRefUpdate(message: string, stderr?: string): Err<GitExecError> {
    return failure({
      type: 'git_error',
      code: 'stale_ref_update',
      message,
      ...(stderr ? { stderr } : {}),
    });
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
  prNotFound(
    prNumber: number,
    message: string
  ): Err<Extract<FetchPrForReviewError, { type: 'not_found' }>> {
    return failure({ type: 'not_found', prNumber, message });
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
