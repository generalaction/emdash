import { ExecError } from '@emdash/core/exec';
import { toGitCommandError, type GitCommandError } from '@emdash/core/git';
import { GitResolutionException } from './allocation/allocation-graph';

/** Converts only failures that the Git contract explicitly treats as operational errors. */
export function expectedGitCommandError(error: unknown): GitCommandError | undefined {
  if (error instanceof GitResolutionException) {
    return { type: 'git_error', message: error.resolution.message };
  }
  if (error instanceof ExecError) return toGitCommandError(error);
  return undefined;
}
