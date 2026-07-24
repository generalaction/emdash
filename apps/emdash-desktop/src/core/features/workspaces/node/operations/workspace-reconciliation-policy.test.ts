import { describe, expect, it } from 'vitest';
import { shouldProposeWorkspaceCleanup } from './workspace-reconciliation-policy';

describe('shouldProposeWorkspaceCleanup', () => {
  it('proposes unmanaged Git worktrees for review', () => {
    expect(
      shouldProposeWorkspaceCleanup(
        { kind: 'candidate', path: '/repo/worktree', tasks: [] },
        '/repo'
      )
    ).toBe(true);
  });

  it('proposes unowned workspace rows but preserves owned and root workspaces', () => {
    expect(
      shouldProposeWorkspaceCleanup(
        { kind: 'workspace', path: '/repo/worktree', tasks: [] },
        '/repo'
      )
    ).toBe(true);
    expect(
      shouldProposeWorkspaceCleanup(
        {
          kind: 'workspace',
          path: '/repo/worktree',
          tasks: [
            {
              taskId: 'task-1',
              name: 'Task',
              status: 'in_progress',
              updatedAt: '2026-07-20T00:00:00.000Z',
            },
          ],
        },
        '/repo'
      )
    ).toBe(false);
    expect(
      shouldProposeWorkspaceCleanup({ kind: 'workspace', path: '/repo', tasks: [] }, '/repo')
    ).toBe(false);
  });
});
