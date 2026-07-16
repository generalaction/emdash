import { describe, expect, it } from 'vitest';
import { shouldProposeWorkspaceCleanup } from './reconciliation-policy';

const task = {
  taskId: 'task-1',
  name: 'Task',
  status: 'in_progress' as const,
  archivedAt: undefined,
  updatedAt: '2026-07-15',
  lastInteractedAt: undefined,
};

describe('shouldProposeWorkspaceCleanup', () => {
  it('proposes unmanaged Git worktrees for review', () => {
    expect(
      shouldProposeWorkspaceCleanup({ kind: 'candidate', path: '/repo/orphan', tasks: [] }, '/repo')
    ).toBe(true);
  });

  it('proposes unowned workspace rows but preserves owned and root workspaces', () => {
    expect(
      shouldProposeWorkspaceCleanup({ kind: 'workspace', path: '/repo/unused', tasks: [] }, '/repo')
    ).toBe(true);
    expect(
      shouldProposeWorkspaceCleanup(
        { kind: 'workspace', path: '/repo/used', tasks: [task] },
        '/repo'
      )
    ).toBe(false);
    expect(shouldProposeWorkspaceCleanup({ kind: 'root', path: '/repo', tasks: [] }, '/repo')).toBe(
      false
    );
  });
});
