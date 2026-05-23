import { describe, expect, it } from 'vitest';
import {
  apiBaseUrlForHost,
  GITHUB_DOT_COM_HOST,
  isGitHubDotCom,
  parseGitHubRepository,
  parseGitHubRepositoryResult,
  splitNameWithOwner,
} from './github-repository';

describe('parseGitHubRepository', () => {
  it('parses canonical owner/repo values, defaulting host to github.com', () => {
    expect(parseGitHubRepository('owner/repo')).toEqual({
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
      nameWithOwner: 'owner/repo',
      repositoryUrl: 'https://github.com/owner/repo',
    });
  });

  it('parses github.com repository URLs and remotes to the same shape', () => {
    const expected = {
      host: 'github.com',
      owner: 'owner',
      repo: 'repo',
      nameWithOwner: 'owner/repo',
      repositoryUrl: 'https://github.com/owner/repo',
    };

    expect(parseGitHubRepository('https://github.com/owner/repo')).toEqual(expected);
    expect(parseGitHubRepository('https://github.com/owner/repo.git')).toEqual(expected);
    expect(parseGitHubRepository('https://www.github.com/owner/repo')).toEqual(expected);
    expect(parseGitHubRepository('git@github.com:owner/repo.git')).toEqual(expected);
    expect(parseGitHubRepository('https://github.com/owner/repo/pulls/1')).toEqual(expected);
  });

  it('captures the host for GitHub Enterprise URLs', () => {
    const expected = {
      host: 'ghe.example.com',
      owner: 'org',
      repo: 'service',
      nameWithOwner: 'org/service',
      repositoryUrl: 'https://ghe.example.com/org/service',
    };

    expect(parseGitHubRepository('https://ghe.example.com/org/service')).toEqual(expected);
    expect(parseGitHubRepository('https://ghe.example.com/org/service.git')).toEqual(expected);
    expect(parseGitHubRepository('git@ghe.example.com:org/service.git')).toEqual(expected);
  });

  it('preserves a leading www. on Enterprise hosts (only github.com is collapsed)', () => {
    expect(parseGitHubRepository('https://www.ghe.example.com/org/service')).toEqual({
      host: 'www.ghe.example.com',
      owner: 'org',
      repo: 'service',
      nameWithOwner: 'org/service',
      repositoryUrl: 'https://www.ghe.example.com/org/service',
    });
  });

  it('preserves a non-default port in the host', () => {
    expect(parseGitHubRepository('https://ghe.example.com:8443/org/service')).toEqual({
      host: 'ghe.example.com:8443',
      owner: 'org',
      repo: 'service',
      nameWithOwner: 'org/service',
      repositoryUrl: 'https://ghe.example.com:8443/org/service',
    });
  });

  it('lowercases the host so different casings produce the same ref', () => {
    expect(parseGitHubRepository('https://Github.com/Owner/Repo')?.host).toEqual('github.com');
    expect(parseGitHubRepository('git@GHE.Example.COM:org/repo.git')?.host).toEqual(
      'ghe.example.com'
    );
  });

  it('returns null for inputs without an owner/repo pair', () => {
    expect(parseGitHubRepository('owner')).toBeNull();
    expect(parseGitHubRepository('')).toBeNull();
    expect(parseGitHubRepository(null)).toBeNull();
    expect(parseGitHubRepository(undefined)).toBeNull();
  });

  it('parses non-GitHub hosts permissively so Enterprise instances on arbitrary domains work', () => {
    // Validation that a host actually speaks the GitHub API is left to the API layer —
    // there is no reliable way to know from a URL alone.
    expect(parseGitHubRepository('https://gitlab.com/owner/repo')).toEqual({
      host: 'gitlab.com',
      owner: 'owner',
      repo: 'repo',
      nameWithOwner: 'owner/repo',
      repositoryUrl: 'https://gitlab.com/owner/repo',
    });
  });
});

describe('splitNameWithOwner', () => {
  it('splits canonical owner/repo', () => {
    expect(splitNameWithOwner('owner/repo')).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('rejects URLs because callers must pass canonical owner/repo', () => {
    expect(() => splitNameWithOwner('https://github.com/owner/repo')).toThrow(
      'Invalid nameWithOwner'
    );
  });
});

describe('parseGitHubRepositoryResult', () => {
  it('returns a typed result for valid inputs', () => {
    expect(parseGitHubRepositoryResult('https://github.com/owner/repo')).toEqual({
      success: true,
      data: {
        host: 'github.com',
        owner: 'owner',
        repo: 'repo',
        nameWithOwner: 'owner/repo',
        repositoryUrl: 'https://github.com/owner/repo',
      },
    });
  });

  it('returns a typed error for unparseable inputs', () => {
    expect(parseGitHubRepositoryResult('not a url')).toEqual({
      success: false,
      error: {
        type: 'invalid-github-repository',
        input: 'not a url',
      },
    });
  });
});

describe('isGitHubDotCom', () => {
  it('distinguishes github.com from Enterprise hosts', () => {
    expect(isGitHubDotCom(parseGitHubRepository('https://github.com/o/r')!)).toBe(true);
    expect(isGitHubDotCom(parseGitHubRepository('https://ghe.example.com/o/r')!)).toBe(false);
  });
});

describe('apiBaseUrlForHost', () => {
  it('returns api.github.com for the public host', () => {
    expect(apiBaseUrlForHost(GITHUB_DOT_COM_HOST)).toBe('https://api.github.com');
  });

  it('returns /api/v3 for Enterprise hosts', () => {
    expect(apiBaseUrlForHost('ghe.example.com')).toBe('https://ghe.example.com/api/v3');
    expect(apiBaseUrlForHost('ghe.example.com:8443')).toBe('https://ghe.example.com:8443/api/v3');
  });
});
