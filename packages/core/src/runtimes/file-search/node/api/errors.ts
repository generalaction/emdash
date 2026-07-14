import type { HostAbsolutePath } from '@primitives/path/api';
import type {
  ContentSearchError,
  FileSearchRegisterRootError,
  FileSearchRootUnavailableReason,
  FileSearchUnregisterRootError,
  PathSearchError,
} from '@runtimes/file-search/api';
import { errorMessage, isOperationalNodeError, nodeErrorCode } from '../node-errors';
import { RootWatchError } from '../path-index/errors';
import { isOperationalSqliteError } from '../storage/errors';

type RootUnavailableError = Extract<FileSearchRegisterRootError, { type: 'root-unavailable' }>;

export function rootUnavailable(
  root: HostAbsolutePath,
  reason: FileSearchRootUnavailableReason,
  message: string
): RootUnavailableError {
  return { type: 'root-unavailable', root, reason, message };
}

export function rootNotRegistered(
  root: HostAbsolutePath
): Extract<PathSearchError | ContentSearchError, { type: 'root-not-registered' }> {
  return {
    type: 'root-not-registered',
    root,
    message: 'Root is not registered for file search',
  };
}

export function indexNotReady(
  root: HostAbsolutePath
): Extract<PathSearchError, { type: 'index-not-ready' }> {
  return {
    type: 'index-not-ready',
    root,
    message: 'The file-search index is still being built',
  };
}

export function toExpectedRootAccessError(
  root: HostAbsolutePath,
  error: unknown,
  subject = 'File-search root'
): RootUnavailableError | undefined {
  switch (nodeErrorCode(error)) {
    case 'ENOENT':
      return rootUnavailable(root, 'not-found', `${subject} does not exist`);
    case 'ENOTDIR':
      return rootUnavailable(root, 'not-a-directory', `${subject} is not a directory`);
    case 'EACCES':
    case 'EPERM':
      return rootUnavailable(root, 'permission-denied', `${subject} cannot be accessed`);
    case 'ELOOP':
      return rootUnavailable(root, 'invalid-path', `${subject} contains a symbolic-link loop`);
    case 'EINVAL':
    case 'ENAMETOOLONG':
      return rootUnavailable(root, 'invalid-path', `${subject} is not a valid filesystem path`);
    default:
      return undefined;
  }
}

export function toExpectedFileSearchIoError(
  root: HostAbsolutePath,
  error: unknown,
  fallback: string
): FileSearchUnregisterRootError | undefined {
  if (!isOperationalNodeError(error) && !isOperationalSqliteError(error)) return undefined;
  return { type: 'io', root, message: errorMessage(error, fallback) };
}

export function toExpectedRootError(
  root: HostAbsolutePath,
  error: unknown,
  fallback: string
): FileSearchRegisterRootError | undefined {
  if (error instanceof RootWatchError) {
    return (
      toExpectedRootAccessError(root, error.cause) ??
      toExpectedFileSearchIoError(root, error.cause, fallback) ?? {
        type: 'io',
        root,
        message: errorMessage(error.cause, error.message),
      }
    );
  }
  return (
    toExpectedRootAccessError(root, error) ?? toExpectedFileSearchIoError(root, error, fallback)
  );
}

export function toExpectedPathIndexError(
  root: HostAbsolutePath,
  error: unknown,
  fallback: string
): PathSearchError | undefined {
  if (error instanceof RootWatchError) {
    return (
      toExpectedRootAccessError(root, error.cause) ??
      toExpectedFileSearchIoError(root, error.cause, fallback) ?? {
        type: 'io',
        root,
        message: errorMessage(error.cause, error.message),
      }
    );
  }
  return (
    toExpectedRootAccessError(root, error) ?? toExpectedFileSearchIoError(root, error, fallback)
  );
}
