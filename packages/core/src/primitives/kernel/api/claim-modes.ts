export const claimModes = [
  /**
   * Read/observe the resource. Coexists with other shared claims, blocks
   * exclusive ones. Example: a scan or measurement of a worktree.
   */
  'shared',

  /**
   * Sole ownership: mutate, move, or destroy the resource. Blocks everything
   * else on the same resource. Example: teardown of a worktree.
   */
  'exclusive',

  /**
   * "Something below me is being read." Planted automatically on ancestors
   * when a descendant takes a shared claim.
   */
  'intent-shared',

  /**
   * "Something below me is being changed." Planted automatically on ancestors
   * when a descendant takes an exclusive claim.
   */
  'intent-exclusive',
] as const;

export type ClaimMode = (typeof claimModes)[number];

export const COMPATIBLE: Record<ClaimMode, Record<ClaimMode, boolean>> = {
  'intent-shared': {
    'intent-shared': true,
    'intent-exclusive': true,
    shared: true,
    exclusive: false,
  },
  'intent-exclusive': {
    'intent-shared': true,
    'intent-exclusive': true,
    shared: false,
    exclusive: false,
  },
  shared: {
    'intent-shared': true,
    'intent-exclusive': false,
    shared: true,
    exclusive: false,
  },
  exclusive: {
    'intent-shared': false,
    'intent-exclusive': false,
    shared: false,
    exclusive: false,
  },
};

export function modesCompatible(held: ClaimMode, requested: ClaimMode): boolean {
  return COMPATIBLE[held][requested];
}
