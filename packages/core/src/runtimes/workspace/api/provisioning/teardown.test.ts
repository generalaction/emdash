import { describe, expect, it } from 'vitest';
import { compileTeardownFromProbe } from './teardown';

describe('compileTeardownFromProbe', () => {
  it('keeps an Emdash-created branch when branch deletion is disabled', () => {
    const plan = compileTeardownFromProbe(
      {
        git: 'worktree',
        path: '/repo-worktrees/task',
        directoryExists: true,
        branchName: 'task',
        branchExists: true,
        branchCreatedByEmdash: true,
        worktree: { registered: true, directoryExists: true },
        setup: 'ready',
      },
      {
        kind: 'worktree',
        repoPath: '/repo',
        path: '/repo-worktrees/task',
        branchName: 'task',
      },
      { deleteBranch: false }
    );

    expect(plan.steps.map((entry) => entry.step.kind)).toEqual(['remove-worktree']);
  });

  it('removes a directory workspace without compiling branch work', () => {
    const plan = compileTeardownFromProbe(
      {
        git: 'none',
        path: '/workspace',
        directoryExists: true,
        branchCreatedByEmdash: false,
        setup: 'not-applicable',
      },
      { kind: 'directory', path: '/workspace' }
    );

    expect(plan.steps.map((entry) => entry.step.kind)).toEqual(['remove-directory']);
  });
});
