import { describe, expect, it } from 'vitest';
import { parseGitRemoteUrl } from './git-remote-resolver';

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
