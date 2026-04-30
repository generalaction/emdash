import { describe, expect, it } from 'vitest';
import {
  parseGitHubRepository,
  parseGitHubRepositoryResult,
  splitNameWithOwner,
} from './github-repository';

describe('parseGitHubRepository', () => {
  it('parses canonical owner/repo values', () => {
    expect(parseGitHubRepository('owner/repo')).toEqual({
      owner: 'owner',
      repo: 'repo',
      nameWithOwner: 'owner/repo',
      repositoryUrl: 'https://github.com/owner/repo',
    });
  });

  it('parses GitHub repository URLs and remotes to a single shape', () => {
    const expected = {
      owner: 'owner',
      repo: 'repo',
      nameWithOwner: 'owner/repo',
      repositoryUrl: 'https://github.com/owner/repo',
    };

    expect(parseGitHubRepository('https://github.com/owner/repo')).toEqual(expected);
    expect(parseGitHubRepository('https://github.com/owner/repo.git')).toEqual(expected);
    expect(parseGitHubRepository('git@github.com:owner/repo.git')).toEqual(expected);
  });

  it('returns null for non-GitHub and malformed values', () => {
    expect(parseGitHubRepository('https://gitlab.com/owner/repo')).toBeNull();
    expect(parseGitHubRepository('owner')).toBeNull();
    expect(parseGitHubRepository('')).toBeNull();
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
  it('returns a typed result for valid and invalid inputs', () => {
    expect(parseGitHubRepositoryResult('https://github.com/owner/repo')).toEqual({
      success: true,
      data: {
        owner: 'owner',
        repo: 'repo',
        nameWithOwner: 'owner/repo',
        repositoryUrl: 'https://github.com/owner/repo',
      },
    });

    expect(parseGitHubRepositoryResult('https://gitlab.com/owner/repo')).toEqual({
      success: false,
      error: {
        type: 'invalid-github-repository',
        input: 'https://gitlab.com/owner/repo',
      },
    });
  });
});
