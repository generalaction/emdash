import { expandOperationStagePlan } from '@emdash/core/primitives/operations/api';
import {
  createWorktreeStagePlan,
  removeRepositoryStagePlan,
  removeWorktreeStagePlan,
} from '@emdash/core/runtimes/workspace-host/api';
import { describe, expect, it } from 'vitest';
import {
  compileCreateWorktreePrediction,
  compileRemoveRepositoryPrediction,
  compileRemoveWorktreePrediction,
} from './compile-host-outbox-prediction';

describe('host outbox prediction stage plans', () => {
  it('uses the create-worktree plan', () => {
    const context = { workspacePath: '/repo/task', fetch: true, existing: false };
    const prediction = compileCreateWorktreePrediction({
      now: 1,
      workspacePath: context.workspacePath,
      branchName: 'task',
      fetch: context.fetch,
    });

    expect(stageIdentity(prediction.stages)).toEqual(
      stageIdentity(expandOperationStagePlan(createWorktreeStagePlan, context))
    );
  });

  it('uses the remove-worktree plan', () => {
    const context = {
      workspacePath: '/repo/task',
      branchName: 'task',
      deleteBranch: true,
      teardownScript: 'pnpm teardown',
    };
    const prediction = compileRemoveWorktreePrediction({ now: 1, ...context });

    expect(stageIdentity(prediction.stages)).toEqual(
      stageIdentity(expandOperationStagePlan(removeWorktreeStagePlan, context))
    );
  });

  it('uses the expanded remove-repository plan', () => {
    const context = {
      repoPath: '/repo',
      worktreePaths: ['/repo', '/repo/task-a', '/repo/task-b'],
      repositoryMissing: false,
    };
    const prediction = compileRemoveRepositoryPrediction({
      now: 1,
      repoPath: context.repoPath,
      worktrees: context.worktreePaths.map((path) => ({ path })),
    });

    expect(stageIdentity(prediction.stages)).toEqual(
      stageIdentity(expandOperationStagePlan(removeRepositoryStagePlan, context))
    );
  });
});

function stageIdentity(stages: readonly { id: string; label: string }[]) {
  return stages.map(({ id, label }) => ({ id, label }));
}
