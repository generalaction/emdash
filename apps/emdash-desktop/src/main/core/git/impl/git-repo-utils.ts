import { parseRepositoryRef } from '@shared/repository-ref';

/**
 * Legacy helper for the SSH GitService adapter. New Git code should use
 * `@emdash/shared/git`.
 */
export function remoteNameForRepositoryUrl(repositoryUrl: string): string {
  const owner = parseRepositoryRef(repositoryUrl)?.owner;
  return owner?.split('/').filter(Boolean).join('-') || 'fork';
}
