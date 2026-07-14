import type { HostAbsolutePath } from '@primitives/path/api';
import type {
  ContentSearchError,
  FileSearchRegisterRootError,
  FileSearchRootUnavailableReason,
  PathSearchError,
} from '@runtimes/file-search/api';
import { nodeErrorCode } from '../node-errors';

type RootUnavailableError = Extract<FileSearchRegisterRootError, { type: 'root-unavailable' }>;

export function rootUnavailable(
  root: HostAbsolutePath,
  reason: FileSearchRootUnavailableReason,
  message: string
): RootUnavailableError {
  return { type: 'root-unavailable', root, reason, message };
}

export function expectedRootAccessError(
  root: HostAbsolutePath,
  error: unknown,
  subject = 'File-search root'
): RootUnavailableError | undefined {
  const code = nodeErrorCode(error);
  switch (code) {
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

export function rootNotRegistered(
  root: HostAbsolutePath
): Extract<PathSearchError | ContentSearchError, { type: 'root-not-registered' }> {
  return {
    type: 'root-not-registered',
    root,
    message: 'Root is not registered for file search',
  };
}
