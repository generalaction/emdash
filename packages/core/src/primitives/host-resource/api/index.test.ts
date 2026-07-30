import { describe, expect, it } from 'vitest';
import { hostResourceKey } from './index';

describe('hostResourceKey', () => {
  it('canonicalizes worktree refs', () => {
    expect(hostResourceKey({ kind: 'worktree', hostId: 'local', path: '/repo/worktree' })).toBe(
      'worktree:local:%2Frepo%2Fworktree'
    );
  });

  it('escapes delimiters in branch refs', () => {
    expect(
      hostResourceKey({
        kind: 'branch',
        hostId: 'remote:1',
        repoPath: '/repo:name',
        branchName: 'feat/a:b',
      })
    ).toBe('branch:remote%3A1:%2Frepo%3Aname:feat%2Fa%3Ab');
  });

  it('canonicalizes repo refs', () => {
    expect(hostResourceKey({ kind: 'repo', hostId: 'local', path: '/repo' })).toBe(
      'repo:local:%2Frepo'
    );
  });
});
