import type { WorkspaceObservedPrFacts } from '@core/primitives/tasks/api';
import {
  normalizeRepositoryUrl,
  recognizePullRequestUrl,
  type PullRequest,
} from '@core/services/pull-requests/api';

export type PrHeadIdentity = {
  repositoryUrl: string;
  refName: string;
};

/** Reads against the synced PR cache; lookup failures should reject, not return null. */
export type PrCacheLookups = {
  /** The cache's PR for a canonical PR URL, or null when the URL is unknown to it. */
  byUrl(url: string): Promise<PullRequest | null>;
  /** Exact PR head match within the base repository's cache. */
  byHead(head: PrHeadIdentity): Promise<PullRequest[]>;
};

/**
 * Derives a task's PR association from observed facts, validated against the PR
 * cache on every read (pr-workspace-model spec, Association):
 *
 * 1. An observed breadcrumb that validates against the cache wins outright.
 * 2. Otherwise the gh-checkout convention (`refs/pull/N/head` + base remote URL) is
 *    recognized as an implicit breadcrumb and validated the same way.
 * 3. Otherwise exact head matching from the ordinary upstream, falling back to
 *    the effective push repository plus local branch. This can therefore never
 *    override a validated breadcrumb or convention association.
 *
 * An unvalidatable breadcrumb (unknown PR, unparseable URL) is ignored silently:
 * association self-corrects with no repair surface. Unobserved workspaces (old
 * hosts) fall straight to effective-push-remote head matching.
 */
export async function derivePrAssociation(input: {
  /** Mirror observedGit v2 facts; null (old host / v1) uses the push-remote fallback. */
  observed: WorkspaceObservedPrFacts | null;
  /** The git runtime's live branch; observed branch backs it up when absent. */
  checkoutBranch: string | null;
  /** Canonical effective push repository URL for old or unpublished checkouts. */
  fallbackHeadRepositoryUrl: string | null;
  lookups: PrCacheLookups;
}): Promise<PullRequest[]> {
  const { observed, lookups } = input;

  if (observed?.prBreadcrumb) {
    const pr = await lookups.byUrl(observed.prBreadcrumb);
    if (pr) return [pr];
  }

  const recognized = recognizePullRequestUrl(observed?.upstream ?? null);
  if (recognized && recognized !== observed?.prBreadcrumb) {
    const pr = await lookups.byUrl(recognized);
    if (pr) return [pr];
  }

  const upstreamHead = ordinaryUpstreamHead(observed?.upstream ?? null);
  if (upstreamHead) return await lookups.byHead(upstreamHead);

  const refName = input.checkoutBranch ?? observed?.branch ?? null;
  if (!refName || !input.fallbackHeadRepositoryUrl) return [];
  return await lookups.byHead({
    repositoryUrl: input.fallbackHeadRepositoryUrl,
    refName,
  });
}

const branchMergeRefPrefix = 'refs/heads/';

function ordinaryUpstreamHead(
  upstream: { mergeRef: string; remoteUrl: string | null } | null
): PrHeadIdentity | null {
  if (!upstream?.remoteUrl || !upstream.mergeRef.startsWith(branchMergeRefPrefix)) return null;
  const repositoryUrl = normalizeRepositoryUrl(upstream.remoteUrl);
  const refName = upstream.mergeRef.slice(branchMergeRefPrefix.length);
  return repositoryUrl && refName ? { repositoryUrl, refName } : null;
}
