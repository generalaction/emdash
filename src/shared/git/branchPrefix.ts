const CONVENTIONAL_TYPES = new Set([
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'chore',
  'ci',
  'build',
  'revert',
]);

/**
 * Split a known conventional-commit type from the front of a slug.
 * Returns `{ type, rest }`. If the slug doesn't start with a known type
 * followed by a hyphen (with remaining content), returns `{ type: null, rest: slug }`.
 */
export function extractSlugType(slug: string): { type: string | null; rest: string } {
  const idx = slug.indexOf('-');
  if (idx <= 0) return { type: null, rest: slug };
  const candidate = slug.slice(0, idx);
  if (CONVENTIONAL_TYPES.has(candidate)) {
    return { type: candidate, rest: slug.slice(idx + 1) };
  }
  return { type: null, rest: slug };
}

/**
 * Build a branch name from a prefix setting, a slug, and a hash.
 *
 * - Custom prefix set:  `{prefix}/{slug}-{hash}` or `{prefix}/{slug}`
 * - No prefix, type detected: `{type}/{rest}-{hash}` or `{type}/{rest}`
 * - No prefix, no type: `{slug}-{hash}` or `{slug}`
 *
 * When `hash` is empty the suffix is omitted.
 */
export function buildBranchName(branchPrefix: string, slug: string, hash: string): string {
  const suffix = hash ? `-${hash}` : '';
  if (branchPrefix) {
    return `${branchPrefix}/${slug}${suffix}`;
  }
  const { type, rest } = extractSlugType(slug);
  if (type) {
    return `${type}/${rest}${suffix}`;
  }
  return `${slug}${suffix}`;
}
