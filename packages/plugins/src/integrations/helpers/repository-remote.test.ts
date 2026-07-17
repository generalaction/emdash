import { describe, expect, it } from 'vitest';
import { resolveInstanceRemote, resolveRemoteRepository } from './repository-remote';

const instanceUrl = 'https://forgejo.example.com';

describe('resolveInstanceRemote', () => {
  it('parses a remote on the configured instance', () => {
    expect(
      resolveInstanceRemote(
        'https://forgejo.example.com/group/sub/repo.git',
        instanceUrl,
        'Forgejo'
      )
    ).toEqual({
      success: true,
      data: { host: 'forgejo.example.com', slug: 'group/sub/repo' },
    });
  });

  it('requires a repository URL', () => {
    expect(resolveInstanceRemote(undefined, instanceUrl, 'Forgejo')).toEqual({
      success: false,
      error: { type: 'invalid_input', message: 'Repository URL is required.' },
    });
    expect(resolveInstanceRemote('   ', instanceUrl, 'Forgejo')).toEqual({
      success: false,
      error: { type: 'invalid_input', message: 'Repository URL is required.' },
    });
  });

  it('requires a parseable repository URL', () => {
    expect(resolveInstanceRemote('not-a-remote', instanceUrl, 'Forgejo')).toEqual({
      success: false,
      error: { type: 'invalid_input', message: 'Unable to parse repository URL.' },
    });
  });

  it('requires the remote host to match the configured instance', () => {
    expect(
      resolveInstanceRemote('https://other.example.com/org/repo.git', instanceUrl, 'Forgejo')
    ).toEqual({
      success: false,
      error: {
        type: 'unsupported_host',
        message:
          'Git remote host "other.example.com" does not match configured Forgejo instance "forgejo.example.com".',
      },
    });
  });

  it('rejects an invalid instance URL', () => {
    expect(
      resolveInstanceRemote('https://forgejo.example.com/org/repo.git', 'not a url', 'Forgejo')
    ).toEqual({
      success: false,
      error: { type: 'invalid_input', message: 'A valid Forgejo instance URL is required.' },
    });
  });
});

describe('resolveRemoteRepository', () => {
  it('resolves an owner/repo repository from an HTTPS remote', () => {
    expect(
      resolveRemoteRepository('https://forgejo.example.com/org/repo.git', instanceUrl, 'Forgejo')
    ).toEqual({
      success: true,
      data: { owner: 'org', repo: 'repo', slug: 'org/repo' },
    });
  });

  it('resolves an owner/repo repository from an scp-like SSH remote', () => {
    expect(
      resolveRemoteRepository('git@forgejo.example.com:org/repo.git', instanceUrl, 'Forgejo')
    ).toEqual({
      success: true,
      data: { owner: 'org', repo: 'repo', slug: 'org/repo' },
    });
  });

  it('rejects nested repository slugs', () => {
    expect(
      resolveRemoteRepository(
        'https://forgejo.example.com/org/team/repo.git',
        instanceUrl,
        'Forgejo'
      )
    ).toEqual({
      success: false,
      error: { type: 'invalid_input', message: 'Unable to extract owner/repo from remote URL.' },
    });
  });
});
