import { parseRepositoryRef } from '@agent/core/primitives/repository/api';
import type { PullRequest } from '@agent/plugins/pull-requests/schemas';

export function normalizeRepositoryUrl(repositoryUrl: string): string | null {
  return parseRepositoryRef(repositoryUrl)?.repositoryUrl ?? null;
}

const ghPrMergeRefPattern = /^refs\/pull\/(\d+)\/head$/;
const gitLabMrMergeRefPattern = /^refs\/merge-requests\/(\d+)\/head$/;

/**
 * Recognizes GitHub PR and GitLab MR head refs as implicit request breadcrumbs.
 * The base remote supplies the repository URL; ordinary branch refs return null.
 */
export function recognizePullRequestUrl(
  upstream: { mergeRef: string; remoteUrl: string | null } | null
): string | null {
  if (!upstream?.remoteUrl) return null;
  const gitLabMatch = gitLabMrMergeRefPattern.exec(upstream.mergeRef);
  const match = gitLabMatch ?? ghPrMergeRefPattern.exec(upstream.mergeRef);
  if (!match) return null;
  const repositoryUrl = normalizeRepositoryUrl(upstream.remoteUrl);
  if (!repositoryUrl) return null;
  return gitLabMatch
    ? `${repositoryUrl}/-/merge_requests/${match[1]}`
    : `${repositoryUrl}/pull/${match[1]}`;
}

export function selectCurrentPr(pullRequests: readonly PullRequest[]): PullRequest | undefined {
  const open = pullRequests.find((pullRequest) => pullRequest.status === 'open');
  if (open) return open;
  return pullRequests.reduce<PullRequest | undefined>(
    (latest, pullRequest) =>
      !latest || pullRequest.createdAt > latest.createdAt ? pullRequest : latest,
    undefined
  );
}

export function isForkPr(
  pullRequest: Pick<PullRequest, 'headRepositoryUrl' | 'repositoryUrl'>
): boolean {
  return pullRequest.headRepositoryUrl !== pullRequest.repositoryUrl;
}

export function getPrNumber(pullRequest: { identifier: string | null }): number | null {
  if (!pullRequest.identifier) return null;
  const number = Number.parseInt(pullRequest.identifier.replace(/^[#!]/, ''), 10);
  return Number.isNaN(number) ? null : number;
}
