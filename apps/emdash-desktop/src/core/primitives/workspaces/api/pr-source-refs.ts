/** Source refs shared by worktree provisioning and associated PR/MR updates. */

/** The forge's read-only PR head ref, fetchable from the base remote for any origin. */
export function prHeadRef(prNumber: number, provider = 'github'): string {
  return provider === 'gitlab'
    ? `refs/merge-requests/${prNumber}/head`
    : `refs/pull/${prNumber}/head`;
}

export function branchHeadRef(branch: string): string {
  return `refs/heads/${branch}`;
}

/**
 * The per-case checkout source: same-repo PRs track the real head branch
 * (commit-and-push preserved); fork PRs the PR ref (review-first — the forge itself
 * rejects pushes).
 */
export function prCheckoutSourceRef(input: {
  prNumber: number;
  provider?: string;
  headBranch: string;
  isFork: boolean;
}): string {
  return input.isFork ? prHeadRef(input.prNumber, input.provider) : branchHeadRef(input.headBranch);
}
