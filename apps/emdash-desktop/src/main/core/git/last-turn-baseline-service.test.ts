import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  inputHandler: null as
    | ((p: {
        projectId: string;
        taskId: string;
        conversationId: string;
        providerId: string;
      }) => Promise<void>)
    | null,
  teardownHandler: null as ((p: { workspaceId: string }) => void) | null,
  getWorkspaceId: vi.fn(),
  resolveWorkspace: vi.fn(),
  emit: vi.fn(),
  snapshotWorktreeTree: vi.fn(),
}));

vi.mock('@main/core/conversations/conversation-events', () => ({
  conversationEvents: {
    on: (name: string, handler: unknown) => {
      if (name === 'conversation:input-submitted') h.inputHandler = handler as never;
      return () => {};
    },
  },
}));

vi.mock('@main/core/tasks/task-session-manager', () => ({
  taskSessionManager: {
    getWorkspaceId: h.getWorkspaceId,
    hooks: {
      on: (name: string, handler: unknown) => {
        if (name === 'task:torn-down') h.teardownHandler = handler as never;
        return () => {};
      },
    },
  },
}));

vi.mock('@main/core/projects/utils', () => ({ resolveWorkspace: h.resolveWorkspace }));
vi.mock('@main/lib/events', () => ({ events: { emit: h.emit } }));

import { lastTurnBaselineService } from './last-turn-baseline-service';

function submitPrompt(taskId = 't-1', projectId = 'p-1') {
  return h.inputHandler!({ projectId, taskId, conversationId: 'c-1', providerId: 'claude' });
}

function mockWorkspace(oid: string) {
  h.getWorkspaceId.mockReturnValue('ws-1');
  h.snapshotWorktreeTree.mockResolvedValue(oid);
  h.resolveWorkspace.mockReturnValue({
    gitWorktree: { snapshotWorktreeTree: h.snapshotWorktreeTree },
  });
}

describe('LastTurnBaselineService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastTurnBaselineService.initialize();
  });

  afterEach(() => {
    lastTurnBaselineService.dispose();
  });

  it('has no baseline before any turn', () => {
    expect(lastTurnBaselineService.getBaseline('ws-1')).toBeUndefined();
  });

  it('captures a worktree snapshot on input-submitted, stores it, and emits', async () => {
    mockWorkspace('tree-abc');

    await submitPrompt();

    expect(h.getWorkspaceId).toHaveBeenCalledWith('t-1');
    expect(h.resolveWorkspace).toHaveBeenCalledWith('p-1', 'ws-1');
    expect(lastTurnBaselineService.getBaseline('ws-1')).toBe('tree-abc');
    expect(h.emit).toHaveBeenCalledWith(expect.anything(), {
      projectId: 'p-1',
      workspaceId: 'ws-1',
    });
  });

  it('overwrites the baseline on each new turn', async () => {
    mockWorkspace('tree-1');
    await submitPrompt();
    h.snapshotWorktreeTree.mockResolvedValue('tree-2');
    await submitPrompt();
    expect(lastTurnBaselineService.getBaseline('ws-1')).toBe('tree-2');
  });

  it('ignores turns whose task has no workspace', async () => {
    h.getWorkspaceId.mockReturnValue(undefined);
    await submitPrompt('t-x');
    expect(h.resolveWorkspace).not.toHaveBeenCalled();
    expect(lastTurnBaselineService.getBaseline('ws-1')).toBeUndefined();
  });

  it('clears a workspace baseline when its task is torn down', async () => {
    mockWorkspace('tree-abc');
    await submitPrompt();
    expect(lastTurnBaselineService.getBaseline('ws-1')).toBe('tree-abc');

    h.teardownHandler!({ workspaceId: 'ws-1' });
    expect(lastTurnBaselineService.getBaseline('ws-1')).toBeUndefined();
  });
});
