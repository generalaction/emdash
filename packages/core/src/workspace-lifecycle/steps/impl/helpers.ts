import type { BootstrapError } from '../../api/schemas';
import { gitErrorMessage, type GitRunError } from '../run-git';

const TRANSIENT_GIT_ERROR_PATTERN =
  /could not resolve host|connection (reset|refused|timed out)|early eof|failed to connect|network is unreachable|operation timed out|the remote end hung up unexpectedly/i;

export function isTransientGitError(message: string): boolean {
  return TRANSIENT_GIT_ERROR_PATTERN.test(message);
}

export function gitFailure(
  type: string,
  error: GitRunError,
  options: { transient?: boolean; resolutions?: string[] } = {}
): { failureClass: 'transient' | 'permanent'; error: BootstrapError } {
  const message = gitErrorMessage(error);
  const transient = options.transient ?? isTransientGitError(message);
  return {
    failureClass: transient ? 'transient' : 'permanent',
    error: {
      type,
      message,
      resolutions: options.resolutions,
    },
  };
}

export function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
