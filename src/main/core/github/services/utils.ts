/**
 * Normalise a git remote URL to a canonical HTTPS form without a `.git` suffix.
 * Used as the stable identifier stored in `repository_url` / `head_repository_url`.
 * Returns the original URL unchanged if it is not a recognisable GitHub remote.
 */
export function normalizeGitHubUrl(remoteUrl: string): string {
  const nwo = parseNameWithOwner(remoteUrl);
  if (!nwo) return remoteUrl;
  return `https://github.com/${nwo}`;
}

/** Returns true when the URL points to a GitHub host (github.com). */
export function isGitHubUrl(remoteUrl: string): boolean {
  return parseNameWithOwner(remoteUrl) !== null;
}

/**
 * Extract owner/repo from a normalised GitHub URL.
 * Works for `https://github.com/owner/repo` (no .git).
 */
export function splitNormalizedUrl(repositoryUrl: string): { owner: string; repo: string } {
  const match = /github\.com\/([^/]+)\/([^/?#]+)/.exec(repositoryUrl);
  if (!match) throw new Error(`Not a GitHub URL: "${repositoryUrl}"`);
  return { owner: match[1], repo: match[2] };
}

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
