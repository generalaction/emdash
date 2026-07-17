import { parseRepositoryRef } from '@shared/repository-ref';
import type { PullRequest } from './schemas';

export function normalizeRepositoryUrl(repositoryUrl: string): string | null {
  return parseRepositoryRef(repositoryUrl)?.repositoryUrl ?? null;
}

export function selectCurrentPr(pullRequests: PullRequest[]): PullRequest | undefined {
  const open = pullRequests.find((pullRequest) => pullRequest.status === 'open');
  if (open) return open;
  return pullRequests.reduce<PullRequest | undefined>(
    (latest, pullRequest) =>
      !latest || pullRequest.createdAt > latest.createdAt ? pullRequest : latest,
    undefined
  );
}

export function isForkPr(pullRequest: PullRequest): boolean {
  return pullRequest.headRepositoryUrl !== pullRequest.repositoryUrl;
}

export function getPrNumber(pullRequest: { identifier: string | null }): number | null {
  if (!pullRequest.identifier) return null;
  const number = Number.parseInt(pullRequest.identifier.replace('#', ''), 10);
  return Number.isNaN(number) ? null : number;
}
