import { ExecError } from '@emdash/core/exec';
import { gitErr, type GitCommandError } from '@emdash/core/git';
import { GitResolutionException } from '../allocation/allocation-graph';
import { InvalidCheckoutPathError } from '../checkout/errors';
import { commandFailed } from '../exec/errors';

/** Converts only failures that the Git contract explicitly treats as operational errors. */
export function expectedGitCommandError(error: unknown): GitCommandError | undefined {
  if (error instanceof GitResolutionException) {
    return gitErr.resolutionFailed(error.resolution.path, error.resolution.message).error;
  }
  if (error instanceof InvalidCheckoutPathError) {
    return gitErr.commandFailed(error.message).error;
  }
  if (error instanceof ExecError) return commandFailed(error).error;
  return undefined;
}
