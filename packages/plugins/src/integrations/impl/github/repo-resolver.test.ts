import { describe, expect, it } from 'vitest';
import { resolveGitHubRepository } from './repo-resolver';
import type { GitHubCredentials } from './types';

const credentials: GitHubCredentials = {
  accessToken: 'token',
  apiBaseUrl: 'https://api.github.com',
};

describe('resolveGitHubRepository', () => {
  it('resolves a github.com repository from an HTTPS remote', () => {
    expect(resolveGitHubRepository(credentials, 'https://github.com/acme/widgets.git')).toEqual({
      success: true,
      data: {
        owner: 'acme',
        repo: 'widgets',
        slug: 'acme/widgets',
      },
    });
  });

  it('resolves a github.com repository from an scp-like SSH remote', () => {
    expect(resolveGitHubRepository(credentials, 'git@github.com:acme/widgets.git')).toEqual({
      success: true,
      data: {
        owner: 'acme',
        repo: 'widgets',
        slug: 'acme/widgets',
      },
    });
  });

  it('resolves a GitHub Enterprise repository from a matching host', () => {
    const enterpriseCredentials: GitHubCredentials = {
      accessToken: 'token',
      apiBaseUrl: 'https://ghe.example.com/api/v3',
    };

    expect(
      resolveGitHubRepository(enterpriseCredentials, 'https://ghe.example.com/acme/widgets.git')
    ).toEqual({
      success: true,
      data: {
        owner: 'acme',
        repo: 'widgets',
        slug: 'acme/widgets',
      },
    });
  });

  it('requires a valid API base URL', () => {
    expect(
      resolveGitHubRepository(
        { accessToken: 'token', apiBaseUrl: 'not a url' },
        'https://github.com/acme/widgets.git'
      )
    ).toEqual({
      success: false,
      error: {
        type: 'invalid_input',
        message: 'A valid GitHub API base URL is required.',
      },
    });
  });

  it('requires a repository URL', () => {
    expect(resolveGitHubRepository(credentials, undefined)).toEqual({
      success: false,
      error: {
        type: 'invalid_input',
        message: 'Repository URL is required.',
      },
    });
  });

  it('requires a parseable repository URL', () => {
    expect(resolveGitHubRepository(credentials, 'not-a-remote')).toEqual({
      success: false,
      error: {
        type: 'invalid_input',
        message: 'Unable to parse repository URL.',
      },
    });
  });

  it('requires the remote host to match the configured GitHub host', () => {
    expect(
      resolveGitHubRepository(credentials, 'https://ghe.example.com/acme/widgets.git')
    ).toEqual({
      success: false,
      error: {
        type: 'unsupported_host',
        message:
          'Git remote host "ghe.example.com" does not match configured GitHub instance "github.com".',
      },
    });
  });

  it('rejects nested repository slugs', () => {
    expect(
      resolveGitHubRepository(credentials, 'https://github.com/acme/team/widgets.git')
    ).toEqual({
      success: false,
      error: {
        type: 'invalid_input',
        message: 'Unable to extract owner/repo from remote URL.',
      },
    });
  });
});
