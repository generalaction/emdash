import type { PrCheckoutDrift } from '@core/services/pull-requests/api';

/** Git facts the drift join needs, from either live checkout state or the registry mirror. */
export type PrDriftObservedFacts = {
  /** Full OID of the observed HEAD; null on unborn HEAD or probe failure. */
  headOid: string | null;
  /** Commits ahead of / behind `@{u}`; null when the tracking ref doesn't resolve. */
  ahead: number | null;
  behind: number | null;
};

/**
 * Derives the checkout-drift state for a PR-associated workspace by joining the
 * live checkout model (falling back to its registry observation) with the synced
 * PR cache (pr-workspace-model spec, Staleness). Pure over its inputs — no
 * observers, no polling, no sync triggers.
 *
 * Detail flags on `drifted` are best-effort against the observed `@{u}` counts
 * (ancestry is not computable desktop-side):
 *
 * - `localAhead`: `ahead > 0` when the tracking ref resolved; null otherwise
 *   (e.g. fork checkouts whose PR-ref upstream isn't a resolvable tracking ref).
 * - `prMoved`: true when the tracking ref has commits the checkout lacks
 *   (`behind > 0`), or when nothing local explains the OID difference
 *   (`ahead === 0`). Null when local commits could explain it (`ahead > 0`
 *   with `behind === 0` — a stale cache after a push is indistinguishable from
 *   an unfetched PR move) and when the counts never resolved.
 */
export function derivePrCheckoutDrift(input: {
  /** Direct checkout live-model facts; preferred whenever that model has emitted. */
  checkout?: PrDriftObservedFacts | null;
  /** Mirror observedGit v2 facts; fallback for an unavailable live checkout model. */
  observed: PrDriftObservedFacts | null;
  /** The associated PR's cache row; null when unassociated or uncached. */
  pr: { headRefOid: string } | null;
  /** The PR cache's last-sync stamp (epoch ms), when known. */
  syncedAt: number | null;
}): PrCheckoutDrift {
  const facts = input.checkout ?? input.observed;
  const headOid = facts?.headOid ?? null;
  const prHeadOid = input.pr?.headRefOid || null;
  if (headOid === null || prHeadOid === null) return { kind: 'unknown' };
  if (headOid === prHeadOid) return { kind: 'in-sync', syncedAt: input.syncedAt };

  const ahead = facts?.ahead ?? null;
  const behind = facts?.behind ?? null;
  return {
    kind: 'drifted',
    localAhead: ahead === null ? null : ahead > 0,
    prMoved: derivePrMoved(ahead, behind),
    syncedAt: input.syncedAt,
  };
}

function derivePrMoved(ahead: number | null, behind: number | null): boolean | null {
  if (behind !== null && behind > 0) return true;
  if (ahead === null) return null;
  return ahead === 0 ? true : null;
}
