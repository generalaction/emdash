import { parseRepositoryRef } from '@shared/repository-ref';

export function normalizeRepositoryUrl(repositoryUrl: string): string | null {
  return parseRepositoryRef(repositoryUrl)?.repositoryUrl ?? null;
}
