import { describe, expect, test } from 'vitest';
import { deleteTaskKernelClaims, projectClaimKey, workspaceKernelClaims } from './resources';

describe('desktop operation kernel resources', () => {
  test('delete task claims include project, repo, and host ancestors', () => {
    expect(
      deleteTaskKernelClaims({
        projectId: 'project-1',
        taskId: 'task-1',
        workspaceId: 'workspace-1',
        workspaceShared: false,
        branch: {
          hostRef: 'local',
          repoPath: '/repo',
          branchName: 'feature/a',
        },
        worktree: {
          hostRef: 'local',
          repoPath: '/repo',
          worktreePath: '/repo/.worktrees/feature',
        },
      }).map((claim) => [claim.resource, claim.key, claim.mode, claim.implicit])
    ).toEqual(
      expect.arrayContaining([
        ['task', 'task:task-1', 'exclusive', false],
        ['project', 'project:project-1', 'intent-exclusive', true],
        ['workspace', 'workspace:workspace-1', 'exclusive', false],
        ['branch', 'branch:local:%2Frepo:feature%2Fa', 'exclusive', false],
        ['worktree', 'worktree:local:%2Frepo%2F.worktrees%2Ffeature', 'exclusive', false],
        ['repo', 'repo:local:%2Frepo', 'intent-exclusive', true],
        ['host', 'host:local', 'intent-exclusive', true],
      ])
    );
  });

  test('workspace claims can be queried by exact project claim key', () => {
    const projectKey = projectClaimKey('project-1');
    expect(
      workspaceKernelClaims({
        projectId: 'project-1',
        workspaceId: 'workspace-1',
      }).some((claim) => claim.resource === 'project' && claim.key === projectKey)
    ).toBe(true);
  });
});
