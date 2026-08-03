import { describe, expect, test } from 'vitest';
import { branchKernelResource, repoKernelResource, worktreeKernelResource } from './index';

describe('host-plane kernel resources', () => {
  test('worktree claims include repo and host ancestor intents', () => {
    expect(
      worktreeKernelResource.mutates({
        hostRef: 'local',
        repoPath: '/repo',
        worktreePath: '/repo/.worktrees/feature',
      })
    ).toEqual([
      {
        resource: 'worktree',
        key: 'worktree:local:%2Frepo%2F.worktrees%2Ffeature',
        mode: 'exclusive',
        implicit: false,
      },
      {
        resource: 'repo',
        key: 'repo:local:%2Frepo',
        mode: 'intent-exclusive',
        implicit: true,
      },
      {
        resource: 'host',
        key: 'host:local',
        mode: 'intent-exclusive',
        implicit: true,
      },
    ]);
  });

  test('repo claims include a host ancestor intent', () => {
    expect(repoKernelResource.reads({ hostRef: 'remote', repoPath: '/repo' })).toEqual([
      {
        resource: 'repo',
        key: 'repo:remote:%2Frepo',
        mode: 'shared',
        implicit: false,
      },
      {
        resource: 'host',
        key: 'host:remote',
        mode: 'intent-shared',
        implicit: true,
      },
    ]);
  });

  test('branch claims parent to the repository', () => {
    expect(
      branchKernelResource.mutates({
        hostRef: 'local',
        repoPath: '/repo',
        branchName: 'feature/a',
      })
    ).toMatchObject([
      { resource: 'branch', key: 'branch:local:%2Frepo:feature%2Fa', implicit: false },
      { resource: 'repo', key: 'repo:local:%2Frepo', implicit: true },
      { resource: 'host', key: 'host:local', implicit: true },
    ]);
  });
});
