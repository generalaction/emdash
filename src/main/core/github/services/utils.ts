export function splitRepo(nameWithOwner: string): { owner: string; repo: string } {
  const idx = nameWithOwner.indexOf('/');
  if (idx === -1) {
    throw new Error(`Invalid nameWithOwner: "${nameWithOwner}" (expected "owner/repo")`);
  }
  return { owner: nameWithOwner.slice(0, idx), repo: nameWithOwner.slice(idx + 1) };
}

/**
 * Extract a GitHub `owner/repo` string from a git remote URL.
 * Handles both HTTPS (`https://github.com/owner/repo.git`) and
 * SSH (`git@github.com:owner/repo.git`) formats.
 * Returns `null` if the URL is not a recognisable GitHub remote.
 */
export function parseNameWithOwner(remoteUrl: string): string | null {
  // https://github.com/owner/repo[.git][/?#...]
  const https = /github\.com\/([^/]+\/[^/?#]+?)(?:\.git)?(?:[/?#]|$)/.exec(remoteUrl);
  if (https) return https[1];
  // git@github.com:owner/repo[.git]
  const ssh = /github\.com:([^/]+\/[^/?#]+?)(?:\.git)?$/.exec(remoteUrl);
  if (ssh) return ssh[1];
  return null;
}
