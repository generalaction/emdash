import { describe, expect, it } from 'vitest';
import type { Remote } from '@shared/git';
import { getGitHubTargetRemotes, resolveCreatePrTargetRemote } from './target-remote';

const remotes: Remote[] = [
  { name: 'origin', url: 'git@github.com:user/repo.git' },
  { name: 'upstream', url: 'git@github.com:org/repo.git' },
  { name: 'gitlab', url: 'git@gitlab.com:user/repo.git' },
];

describe('getGitHubTargetRemotes', () => {
  it('returns only remotes that point at GitHub repositories', () => {
    expect(getGitHubTargetRemotes(remotes).map((option) => option.remote.name)).toEqual([
      'origin',
      'upstream',
    ]);
  });
});

describe('resolveCreatePrTargetRemote', () => {
  const options = getGitHubTargetRemotes(remotes);

  it('defaults to the project remote when it is a GitHub remote', () => {
    expect(
      resolveCreatePrTargetRemote({
        options,
        projectRemoteName: 'upstream',
      })?.remote.name
    ).toBe('upstream');
  });

  it('uses the selected modal target when provided', () => {
    expect(
      resolveCreatePrTargetRemote({
        options,
        projectRemoteName: 'upstream',
        selectedRemoteName: 'origin',
      })?.remote.name
    ).toBe('origin');
  });

  it('falls back to the repository URL when the project remote is not GitHub', () => {
    expect(
      resolveCreatePrTargetRemote({
        options,
        projectRemoteName: 'gitlab',
        fallbackRepositoryUrl: 'https://github.com/org/repo',
      })?.remote.name
    ).toBe('upstream');
  });
});
