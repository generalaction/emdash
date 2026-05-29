import { describe, expect, it } from 'vitest';
import type { CreateTaskParams } from '@shared/tasks';
import { TASK_KIND } from '@shared/tasks';
import { taskCreatedTelemetryStrategy } from './task-created-strategy';

const sourceBranch = { type: 'local' as const, branch: 'main' };

function params(overrides: Partial<CreateTaskParams> = {}): CreateTaskParams {
  return {
    id: 'task-1',
    projectId: 'project-1',
    name: 'Task 1',
    sourceBranch,
    strategy: { kind: 'new-branch', taskBranch: 'feature/task-1' },
    ...overrides,
  };
}

describe('taskCreatedTelemetryStrategy', () => {
  it('reports chat for chat tasks even with no-worktree strategy', () => {
    expect(
      taskCreatedTelemetryStrategy(
        params({
          kind: TASK_KIND.Chat,
          strategy: { kind: 'no-worktree' },
        })
      )
    ).toBe('chat');
  });

  it('prefers chat over linked issues', () => {
    expect(
      taskCreatedTelemetryStrategy(
        params({
          kind: TASK_KIND.Chat,
          strategy: { kind: 'no-worktree' },
          linkedIssue: {
            provider: 'linear',
            url: 'https://linear.app/acme/issue/ENG-1',
            title: 'Issue',
            identifier: 'ENG-1',
          },
        })
      )
    ).toBe('chat');
  });

  it('reports blank for regular no-worktree tasks', () => {
    expect(
      taskCreatedTelemetryStrategy(
        params({
          strategy: { kind: 'no-worktree' },
        })
      )
    ).toBe('blank');
  });

  it('reports branch for new-branch tasks', () => {
    expect(taskCreatedTelemetryStrategy(params())).toBe('branch');
  });

  it('reports branch for checkout-existing tasks', () => {
    expect(
      taskCreatedTelemetryStrategy(
        params({
          strategy: { kind: 'checkout-existing' },
        })
      )
    ).toBe('branch');
  });

  it('reports pr for pull-request tasks', () => {
    expect(
      taskCreatedTelemetryStrategy(
        params({
          strategy: {
            kind: 'from-pull-request',
            prNumber: 42,
            headBranch: 'feature',
            headRepositoryUrl: 'https://github.com/acme/repo.git',
            isFork: false,
          },
        })
      )
    ).toBe('pr');
  });

  it('prefers pr over linked issues', () => {
    expect(
      taskCreatedTelemetryStrategy(
        params({
          strategy: {
            kind: 'from-pull-request',
            prNumber: 42,
            headBranch: 'feature',
            headRepositoryUrl: 'https://github.com/acme/repo.git',
            isFork: false,
          },
          linkedIssue: {
            provider: 'github',
            url: 'https://github.com/acme/repo/issues/1',
            title: 'Issue',
            identifier: '#1',
          },
        })
      )
    ).toBe('pr');
  });

  it('reports issue when a linked issue is present', () => {
    expect(
      taskCreatedTelemetryStrategy(
        params({
          linkedIssue: {
            provider: 'github',
            url: 'https://github.com/acme/repo/issues/1',
            title: 'Issue',
            identifier: '#1',
          },
        })
      )
    ).toBe('issue');
  });
});
