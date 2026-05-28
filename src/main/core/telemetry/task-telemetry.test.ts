import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateTaskParams, Task } from '@shared/tasks';
import { TASK_KIND } from '@shared/tasks';
import { captureTaskCreatedTelemetry, captureTaskProvisionedTelemetry } from './task-telemetry';

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
}));

vi.mock('@main/lib/telemetry', () => ({
  telemetryService: {
    capture: mocks.capture,
  },
}));

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'chat-1',
    projectId: 'project-1',
    name: 'chat-may-27',
    kind: TASK_KIND.Chat,
    status: 'in_progress',
    sourceBranch: { type: 'local', branch: 'main' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    statusChangedAt: '2026-01-01T00:00:00.000Z',
    isPinned: false,
    prs: [],
    conversations: {},
    ...overrides,
  };
}

function makeCreateParams(overrides: Partial<CreateTaskParams> = {}): CreateTaskParams {
  return {
    id: 'chat-1',
    projectId: 'project-1',
    name: 'chat-may-27',
    kind: TASK_KIND.Chat,
    sourceBranch: { type: 'local', branch: 'main' },
    strategy: { kind: 'no-worktree' },
    ...overrides,
  };
}

describe('captureTaskCreatedTelemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('captures chat strategy for chat-only task creation', () => {
    captureTaskCreatedTelemetry(makeTask(), makeCreateParams());

    expect(mocks.capture).toHaveBeenCalledWith('task_created', {
      strategy: 'chat',
      has_initial_prompt: false,
      has_issue: 'none',
      provider: null,
      project_id: 'project-1',
      task_id: 'chat-1',
    });
  });

  it('captures blank strategy for regular no-worktree tasks', () => {
    captureTaskCreatedTelemetry(
      makeTask({ id: 'task-1', name: 'Blank task', kind: TASK_KIND.Task }),
      makeCreateParams({ id: 'task-1', name: 'Blank task', kind: undefined })
    );

    expect(mocks.capture).toHaveBeenCalledWith(
      'task_created',
      expect.objectContaining({
        strategy: 'blank',
        task_id: 'task-1',
      })
    );
  });

  it('captures initial prompt and provider when present', () => {
    captureTaskCreatedTelemetry(
      makeTask(),
      makeCreateParams({
        initialConversation: {
          id: 'conv-1',
          taskId: 'chat-1',
          projectId: 'project-1',
          provider: 'claude',
          title: 'Chat',
          initialPrompt: '  hello  ',
        },
      })
    );

    expect(mocks.capture).toHaveBeenCalledWith(
      'task_created',
      expect.objectContaining({
        strategy: 'chat',
        has_initial_prompt: true,
        provider: 'claude',
      })
    );
  });

  it('captures issue_linked_to_task when a linked issue is present', () => {
    captureTaskCreatedTelemetry(
      makeTask({ kind: TASK_KIND.Task }),
      makeCreateParams({
        kind: TASK_KIND.Task,
        strategy: { kind: 'new-branch', taskBranch: 'feature/task-1' },
        linkedIssue: {
          provider: 'linear',
          url: 'https://linear.app/acme/issue/ENG-1',
          title: 'Issue',
          identifier: 'ENG-1',
        },
      })
    );

    expect(mocks.capture).toHaveBeenCalledWith(
      'issue_linked_to_task',
      expect.objectContaining({
        provider: 'linear',
        project_id: 'project-1',
        task_id: 'chat-1',
      })
    );
  });
});

describe('captureTaskProvisionedTelemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('captures task_provisioned with project and task ids', () => {
    captureTaskProvisionedTelemetry('project-1', 'chat-1');

    expect(mocks.capture).toHaveBeenCalledWith('task_provisioned', {
      project_id: 'project-1',
      task_id: 'chat-1',
    });
  });
});
