import { describe, expect, test } from 'vitest';
import { defineResource } from './resources';

const hostResource = defineResource({
  name: 'host',
  key: (ref: { hostId: string }) => `host:${ref.hostId}`,
});

const repoResource = defineResource({
  name: 'repo',
  key: (ref: { hostId: string; repoPath: string }) => `repo:${ref.hostId}:${ref.repoPath}`,
  parent: (ref) => ({ def: hostResource, ref: { hostId: ref.hostId } }),
});

const worktreeResource = defineResource({
  name: 'worktree',
  key: (ref: { hostId: string; repoPath: string; worktreePath: string }) =>
    `worktree:${ref.hostId}:${ref.worktreePath}`,
  parent: (ref) => ({
    def: repoResource,
    ref: { hostId: ref.hostId, repoPath: ref.repoPath },
  }),
});

const worktreeRef = {
  hostId: 'h1',
  repoPath: '/repo',
  worktreePath: '/worktree',
};

describe('defineResource', () => {
  test('expands mutating claims to exclusive plus ancestor intent-exclusive claims', () => {
    expect(worktreeResource.mutates(worktreeRef)).toEqual([
      {
        resource: 'worktree',
        key: 'worktree:h1:/worktree',
        mode: 'exclusive',
        implicit: false,
      },
      { resource: 'repo', key: 'repo:h1:/repo', mode: 'intent-exclusive', implicit: true },
      { resource: 'host', key: 'host:h1', mode: 'intent-exclusive', implicit: true },
    ]);
  });

  test('expands reading claims to shared plus ancestor intent-shared claims', () => {
    expect(worktreeResource.reads(worktreeRef)).toEqual([
      { resource: 'worktree', key: 'worktree:h1:/worktree', mode: 'shared', implicit: false },
      { resource: 'repo', key: 'repo:h1:/repo', mode: 'intent-shared', implicit: true },
      { resource: 'host', key: 'host:h1', mode: 'intent-shared', implicit: true },
    ]);
  });

  test('uses ancestor definitions for ancestor keys', () => {
    const claims = worktreeResource.mutates(worktreeRef);

    expect(claims[1]?.key).toBe(repoResource.key({ hostId: 'h1', repoPath: '/repo' }));
    expect(claims[2]?.key).toBe(hostResource.key({ hostId: 'h1' }));
  });
});
