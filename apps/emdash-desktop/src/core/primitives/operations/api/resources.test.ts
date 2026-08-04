import { formatHostRef, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
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
          projectId: 'project-1',
          branchName: 'feature/a',
        },
        worktree: {
          hostRef: formatHostRef(LOCAL_HOST_REF),
          repoPath: '/repo',
          worktreePath: '/repo/.worktrees/feature',
        },
      }).map((claim) => [claim.resource, claim.key, claim.mode, claim.implicit])
    ).toEqual(
      expect.arrayContaining([
        ['task', 'task:task-1', 'exclusive', false],
        ['project', 'project:project-1', 'intent-exclusive', true],
        ['workspace', 'workspace:workspace-1', 'exclusive', false],
        ['branch', 'branch:project-1:feature%2Fa', 'exclusive', false],
        ['worktree', 'worktree:local%3Alocal:%2Frepo%2F.worktrees%2Ffeature', 'exclusive', false],
        ['repo', 'repo:local%3Alocal:%2Frepo', 'intent-exclusive', true],
        ['host', 'host:local%3Alocal', 'intent-exclusive', true],
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
