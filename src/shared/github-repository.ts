import { err, ok, type Result } from './result';

export const GITHUB_DOT_COM_HOST = 'github.com';

export type GitHubRepositoryRef = {
  /** Lowercase host, e.g. "github.com" or "ghe.example.com". May include a port. */
  host: string;
  owner: string;
  repo: string;
  nameWithOwner: string;
  /** Canonical URL `https://${host}/${nameWithOwner}` — used as a stable identifier. */
  repositoryUrl: string;
};

export type GitHubRepositoryParseError = {
  type: 'invalid-github-repository';
  input: string;
};

function stripGitSuffix(value: string): string {
  return value.endsWith('.git') ? value.slice(0, -4) : value;
}

// Only the public `www.github.com` redirect is collapsed to its canonical host.
// Enterprise instances whose DNS legitimately starts with `www.` (e.g. `www.ghe.corp.com`)
// keep the prefix so API calls hit the address that actually resolves.
function normalizeHost(rawHost: string): string {
  const lower = rawHost.trim().toLowerCase();
  return lower === `www.${GITHUB_DOT_COM_HOST}` ? GITHUB_DOT_COM_HOST : lower;
}

function toRepositoryRef(
  host: string | undefined,
  owner: string | undefined,
  repo: string | undefined
): GitHubRepositoryRef | null {
  const normalizedHost = normalizeHost(host ?? GITHUB_DOT_COM_HOST);
  const normalizedOwner = owner?.trim();
  const normalizedRepo = stripGitSuffix(repo?.trim() ?? '');
  if (!normalizedHost || !normalizedOwner || !normalizedRepo) return null;
  const nameWithOwner = `${normalizedOwner}/${normalizedRepo}`;
  return {
    host: normalizedHost,
    owner: normalizedOwner,
    repo: normalizedRepo,
    nameWithOwner,
    repositoryUrl: `https://${normalizedHost}/${nameWithOwner}`,
  };
}

// Parser is intentionally permissive about host — GitHub Enterprise instances can use any
// hostname, and there is no reliable way to detect "this URL points at a GitHub-compatible
// server" from the URL alone. Callers that need to short-circuit github.com vs. Enterprise
// can use `isGitHubDotCom(ref)`.
export function parseGitHubRepository(input?: string | null): GitHubRepositoryRef | null {
  const value = input?.trim();
  if (!value) return null;

  const sshMatch = value.match(/^git@([^:/\s]+):([^/\s]+)\/([^/\s?#]+?)(?:\.git)?$/i);
  if (sshMatch) return toRepositoryRef(sshMatch[1], sshMatch[2], sshMatch[3]);

  const urlMatch = value.match(
    /^https?:\/\/([^/\s]+)\/([^/\s]+)\/([^/\s?#]+?)(?:\.git)?(?:[/?#].*)?$/i
  );
  if (urlMatch) return toRepositoryRef(urlMatch[1], urlMatch[2], urlMatch[3]);

  const canonicalMatch = value.match(/^([^/\s:]+)\/([^/\s?#]+?)(?:\.git)?$/i);
  if (canonicalMatch) return toRepositoryRef(undefined, canonicalMatch[1], canonicalMatch[2]);

  return null;
}

export function parseGitHubRepositoryResult(
  input: string
): Result<GitHubRepositoryRef, GitHubRepositoryParseError> {
  const repository = parseGitHubRepository(input);
  return repository
    ? ok(repository)
    : err({
        type: 'invalid-github-repository',
        input,
      });
}

export function splitNameWithOwner(nameWithOwner: string): { owner: string; repo: string } {
  const parsed = parseGitHubRepository(nameWithOwner);
  if (!parsed || parsed.nameWithOwner !== nameWithOwner.trim()) {
    throw new Error(`Invalid nameWithOwner: "${nameWithOwner}" (expected "owner/repo")`);
  }
  return { owner: parsed.owner, repo: parsed.repo };
}

export function isGitHubDotCom(ref: GitHubRepositoryRef): boolean {
  return ref.host === GITHUB_DOT_COM_HOST;
}

/**
 * Octokit baseUrl for the given host. github.com uses the public API; Enterprise Server
 * exposes its API at `https://${host}/api/v3` per GHES convention.
 */
export function apiBaseUrlForHost(host: string): string {
  return host === GITHUB_DOT_COM_HOST ? 'https://api.github.com' : `https://${host}/api/v3`;
}
