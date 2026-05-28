import type { PushError } from '@shared/git';

type PushLikeError = PushError | { type: string; message?: string };

export function extractErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return 'Unknown error';
}

export function splitPath(filePath: string) {
  const parts = filePath.split('/');
  const filename = parts.pop() || filePath;
  const directory = parts.length > 0 ? parts.join('/') : '';
  return { filename, directory };
}

export function friendlyGitError(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes('non-fast-forward') || s.includes('tip of your current branch is behind'))
    return 'Remote has new commits. Pull before pushing.';
  if (s.includes('merge conflict') || s.includes('fix conflicts'))
    return 'Merge conflicts detected. Resolve them in your editor.';
  if (s.includes('permission denied') || s.includes('authentication'))
    return 'Authentication failed. Check your credentials.';
  if (s.includes('could not resolve host') || s.includes('unable to access'))
    return 'Cannot reach remote. Check your network connection.';
  if (s.includes('no such remote')) return 'No remote configured for this repository.';
  if (s.includes('cannot undo the initial commit')) return 'Cannot undo the initial commit.';
  if (s.includes('nothing to commit')) return 'Nothing to commit.';
  const firstLine = raw.split('\n').find((l) => l.trim().length > 0) || raw;
  return firstLine.length > 120 ? firstLine.slice(0, 120) + '...' : firstLine;
}

const GITHUB_REPOSITORY_ACCESS_ERROR =
  'GitHub could not find the repository, or your local Git credentials do not have write access.';
const GITHUB_AUTHENTICATION_ERROR =
  'GitHub authentication failed. Authenticate Git on this machine, or configure a fork as the project push remote.';

export function formatPushErrorDetail(error: PushLikeError): string {
  const message = 'message' in error ? (error.message ?? error.type) : error.type;
  const normalized = message.toLowerCase();

  if (
    normalized.includes('github.com') &&
    (normalized.includes('repository not found') ||
      normalized.includes('fatal: repository') ||
      normalized.includes('not found'))
  ) {
    return GITHUB_REPOSITORY_ACCESS_ERROR;
  }

  if (
    normalized.includes('github.com') &&
    (normalized.includes('could not read username') ||
      normalized.includes('terminal prompts disabled') ||
      normalized.includes('authentication failed') ||
      normalized.includes('permission denied'))
  ) {
    return GITHUB_AUTHENTICATION_ERROR;
  }

  return message;
}
