import { describe, expect, it } from 'vitest';
import { remoteNameForRepositoryUrl } from './git-repo-utils';

describe('remoteNameForRepositoryUrl', () => {
  it('derives a stable remote name from the repository owner', () => {
    expect(remoteNameForRepositoryUrl('https://github.com/acme/repo.git')).toBe('acme');
    expect(remoteNameForRepositoryUrl('git@github.com:org/team/repo.git')).toBe('org-team');
    expect(remoteNameForRepositoryUrl('not-a-repository')).toBe('fork');
  });
});
