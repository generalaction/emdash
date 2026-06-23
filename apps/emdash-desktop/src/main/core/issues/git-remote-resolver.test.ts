import { describe, expect, it } from 'vitest';
import { parseGitRemoteUrl, resolveRepositoryRemote } from './git-remote-resolver';

describe('parseGitRemoteUrl', () => {
  it('parses scp-like remotes', () => {
    expect(parseGitRemoteUrl('git@gitlab.com:group/repo.git')).toEqual({
      host: 'gitlab.com',
      slug: 'group/repo',
    });
  });

  it('parses ssh remotes', () => {
    expect(parseGitRemoteUrl('ssh://git@gitlab.example.com/group/repo.git')).toEqual({
      host: 'gitlab.example.com',
      slug: 'group/repo',
    });
  });

  it('parses https remotes', () => {
    expect(parseGitRemoteUrl('https://forgejo.example.com/org/repo.git')).toEqual({
      host: 'forgejo.example.com',
      slug: 'org/repo',
    });
  });

  it('returns null for invalid remotes', () => {
    expect(parseGitRemoteUrl('')).toBeNull();
    expect(parseGitRemoteUrl('not-a-remote')).toBeNull();
  });
});

describe('resolveRepositoryRemote', () => {
  it('resolves a repository URL without shelling out to git', () => {
    expect(resolveRepositoryRemote('https://gitlab.example.com/group/repo.git')).toEqual({
      host: 'gitlab.example.com',
      slug: 'group/repo',
    });
  });

  it('requires a parseable repository URL', () => {
    expect(() => resolveRepositoryRemote(undefined)).toThrow('Repository URL is required.');
    expect(() => resolveRepositoryRemote('not-a-remote')).toThrow(
      'Unable to parse repository URL.'
    );
  });
});
