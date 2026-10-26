import { describe, expect, it } from 'vitest';
import { getPrNumber, recognizePullRequestUrl } from './repository';

describe('getPrNumber', () => {
  it('reads GitHub and GitLab identifiers', () => {
    expect(getPrNumber({ identifier: '#42' })).toBe(42);
    expect(getPrNumber({ identifier: '!42' })).toBe(42);
  });
});

describe('recognizePullRequestUrl', () => {
  it('recognizes the gh CLI convention (refs/pull/N/head + https remote)', () => {
    expect(
      recognizePullRequestUrl({
        mergeRef: 'refs/pull/123/head',
        remoteUrl: 'https://github.com/emdash/emdash.git',
      })
    ).toBe('https://github.com/emdash/emdash/pull/123');
  });

  it('normalizes scp-style ssh remotes to the canonical repository URL', () => {
    expect(
      recognizePullRequestUrl({
        mergeRef: 'refs/pull/7/head',
        remoteUrl: 'git@github.com:emdash/emdash.git',
      })
    ).toBe('https://github.com/emdash/emdash/pull/7');
  });

  it('returns null for ordinary branch mergeRefs', () => {
    expect(
      recognizePullRequestUrl({
        mergeRef: 'refs/heads/feature',
        remoteUrl: 'https://github.com/emdash/emdash',
      })
    ).toBeNull();
  });

  it('recognizes GitLab MR refs with nested groups', () => {
    expect(
      recognizePullRequestUrl({
        mergeRef: 'refs/merge-requests/9/head',
        remoteUrl: 'git@gitlab.com:group/subgroup/repo.git',
      })
    ).toBe('https://gitlab.com/group/subgroup/repo/-/merge_requests/9');
  });

  it('returns null without a resolvable remote URL', () => {
    expect(recognizePullRequestUrl({ mergeRef: 'refs/pull/1/head', remoteUrl: null })).toBeNull();
    expect(
      recognizePullRequestUrl({ mergeRef: 'refs/pull/1/head', remoteUrl: 'not a remote' })
    ).toBeNull();
    expect(recognizePullRequestUrl(null)).toBeNull();
  });

  it('rejects malformed pull numbers', () => {
    expect(
      recognizePullRequestUrl({
        mergeRef: 'refs/pull/12x/head',
        remoteUrl: 'https://github.com/emdash/emdash',
      })
    ).toBeNull();
  });
});
