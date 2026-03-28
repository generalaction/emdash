/**
 * Extract a PR number from user input.
 * Accepts a plain number (e.g. "1603", "#1603") or a GitHub PR URL
 * (e.g. "https://github.com/org/repo/pull/1603").
 * Returns the PR number or null if the input is not valid.
 */
export function parsePrInput(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Try plain number (with optional leading #)
  const numMatch = trimmed.match(/^#?(\d+)$/);
  if (numMatch) {
    const n = Number.parseInt(numMatch[1], 10);
    return n > 0 ? n : null;
  }

  // Try GitHub PR URL: https://<host>/<owner>/<repo>/pull/<number>[/...]
  const urlMatch = trimmed.match(/^https?:\/\/[^/]+\/[^/]+\/[^/]+\/pull\/(\d+)/);
  if (urlMatch) {
    const n = Number.parseInt(urlMatch[1], 10);
    return n > 0 ? n : null;
  }

  return null;
}
