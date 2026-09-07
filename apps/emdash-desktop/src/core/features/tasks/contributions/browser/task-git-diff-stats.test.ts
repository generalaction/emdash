import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskStore } from '@core/features/tasks/api/browser/stores/task-store';
import { useTaskGitDiffStats } from './task-git-diff-stats';

const mocks = vi.hoisted(() => ({
  git: undefined as
    | { totalLinesAdded: number; totalLinesDeleted: number; error: string | undefined }
    | undefined,
  taskStatsObservation: { kind: 'unavailable' } as { kind: 'unavailable' } | { kind: 'fresh' },
}));

vi.mock('@core/features/source-control/api/browser/stores/task-source-control-selectors', () => ({
  getTaskGitCheckoutStore: () => mocks.git,
}));

vi.mock('@core/features/tasks/api/browser/task-state/task-selectors', () => ({
  getTaskManagerStore: () => ({ taskStatsObservation: mocks.taskStatsObservation }),
}));

describe('useTaskGitDiffStats', () => {
  beforeEach(() => {
    mocks.git = undefined;
    mocks.taskStatsObservation = { kind: 'unavailable' };
  });

  it('shows live checkout totals before cached task stats have been observed', () => {
    mocks.git = {
      totalLinesAdded: 7,
      totalLinesDeleted: 2,
      error: undefined,
    };
    const task = {
      state: 'provisioned',
      data: { id: 'task-1', projectId: 'project-1' },
    } as TaskStore;

    expect(useTaskGitDiffStats(task)).toMatchObject({
      linesAdded: 7,
      linesDeleted: 2,
      visible: true,
    });
  });

  it('still requires a fresh or stale observation for cached totals', () => {
    const task = {
      state: 'unprovisioned',
      data: {
        id: 'task-1',
        projectId: 'project-1',
        workspaceGit: { linesAdded: 7, linesDeleted: 2 },
      },
    } as TaskStore;

    expect(useTaskGitDiffStats(task).visible).toBe(false);

    mocks.taskStatsObservation = { kind: 'fresh' };
    expect(useTaskGitDiffStats(task).visible).toBe(true);
  });
});
