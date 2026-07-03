import { describe, expect, it } from 'vitest';
import type { ForgejoCredentials } from '../../../integrations/impl/forgejo/types';
import { resolveForgejoRepository } from './repo-resolver';

const credentials: ForgejoCredentials = {
  instanceUrl: 'https://forgejo.example.com',
  apiToken: 'token',
};

describe('resolveForgejoRepository', () => {
  it('resolves a Forgejo repository from an HTTPS remote', () => {
    expect(
      resolveForgejoRepository(credentials, 'https://forgejo.example.com/org/repo.git')
    ).toEqual({
      success: true,
      data: {
        owner: 'org',
        repo: 'repo',
        repoName: 'repo',
      },
    });
  });

  it('resolves a Forgejo repository from an scp-like SSH remote', () => {
    expect(resolveForgejoRepository(credentials, 'git@forgejo.example.com:org/repo.git')).toEqual({
      success: true,
      data: {
        owner: 'org',
        repo: 'repo',
        repoName: 'repo',
      },
    });
  });

  it('requires a repository URL', () => {
    expect(resolveForgejoRepository(credentials, undefined)).toEqual({
      success: false,
      error: {
        type: 'invalid_input',
        message: 'Repository URL is required.',
      },
    });
  });

  it('requires a parseable repository URL', () => {
    expect(resolveForgejoRepository(credentials, 'not-a-remote')).toEqual({
      success: false,
      error: {
        type: 'invalid_input',
        message: 'Unable to parse repository URL.',
      },
    });
  });

  it('requires the remote host to match the configured instance', () => {
    expect(resolveForgejoRepository(credentials, 'https://other.example.com/org/repo.git')).toEqual(
      {
        success: false,
        error: {
          type: 'unsupported_host',
          message:
            'Git remote host "other.example.com" does not match configured Forgejo instance "forgejo.example.com".',
        },
      }
    );
  });

  it('rejects nested repository slugs', () => {
    expect(
      resolveForgejoRepository(credentials, 'https://forgejo.example.com/org/team/repo.git')
    ).toEqual({
      success: false,
      error: {
        type: 'invalid_input',
        message: 'Unable to extract owner/repo from remote URL.',
      },
    });
  });
});
