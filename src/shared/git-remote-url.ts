/**
 * Convert a git remote URL to a browser-friendly HTTPS URL.
 *
 * Handles:
 *   git@github.com:owner/repo.git  →  https://github.com/owner/repo
 *   https://github.com/owner/repo.git  →  https://github.com/owner/repo
 *   https://github.com/owner/repo  →  https://github.com/owner/repo
 *
 * Returns undefined if the URL can't be parsed.
 */
export function gitRemoteToUrl(remote: string): string | undefined {
  // SSH style: git@github.com:owner/repo.git
  const sshMatch = remote.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return `https://${sshMatch[1]}/${sshMatch[2]}`;
  }

  // HTTPS style: https://github.com/owner/repo.git or without .git
  const httpsMatch = remote.match(/^https?:\/\/([^/]+\/.+?)(?:\.git)?$/);
  if (httpsMatch) {
    return `https://${httpsMatch[1]}`;
  }

  return undefined;
}
