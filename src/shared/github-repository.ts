import { err, ok, type Result } from './result';

export type GitHubRepositoryRef = {
  owner: string;
  repo: string;
  nameWithOwner: string;
  repositoryUrl: string;
};

export type GitHubRepositoryParseError = {
  type: 'invalid-github-repository';
  input: string;
};

function stripGitSuffix(value: string): string {
  return value.endsWith('.git') ? value.slice(0, -4) : value;
}

function toRepositoryRef(
  owner: string | undefined,
  repo: string | undefined
): GitHubRepositoryRef | null {
  const normalizedOwner = owner?.trim();
  const normalizedRepo = stripGitSuffix(repo?.trim() ?? '');
  if (!normalizedOwner || !normalizedRepo) return null;
  const nameWithOwner = `${normalizedOwner}/${normalizedRepo}`;
  return {
    owner: normalizedOwner,
    repo: normalizedRepo,
    nameWithOwner,
    repositoryUrl: `https://github.com/${nameWithOwner}`,
  };
}

export function parseGitHubRepository(input?: string | null): GitHubRepositoryRef | null {
  const value = input?.trim();
  if (!value) return null;

  const sshMatch = /^git@github\.com:([^/\s]+)\/([^/\s?#]+?)(?:\.git)?$/i.exec(value);
  if (sshMatch) return toRepositoryRef(sshMatch[1], sshMatch[2]);

  const urlMatch =
    /^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s?#]+?)(?:\.git)?(?:[/?#].*)?$/i.exec(
      value
    );
  if (urlMatch) return toRepositoryRef(urlMatch[1], urlMatch[2]);

  const canonicalMatch = /^([^/\s:]+)\/([^/\s?#]+?)(?:\.git)?$/i.exec(value);
  if (canonicalMatch) return toRepositoryRef(canonicalMatch[1], canonicalMatch[2]);

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
