import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteConversation } from './deleteConversation';

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  deleteRows: vi.fn(),
  deleteWhere: vi.fn(),
  emit: vi.fn(),
  getProject: vi.fn(),
  killTmuxSessionsByPtyIds: vi.fn(),
  resolveTask: vi.fn(),
  selectLimit: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: mocks.selectLimit }),
      }),
    }),
    delete: mocks.deleteRows,
  },
}));

vi.mock('@main/core/projects/project-manager', () => ({
  projectManager: { getProject: mocks.getProject },
}));

vi.mock('@main/core/pty/tmux-reaper', () => ({
  killTmuxSessionsByPtyIds: mocks.killTmuxSessionsByPtyIds,
}));

vi.mock('@main/lib/telemetry', () => ({
  telemetryService: { capture: mocks.capture },
}));

vi.mock('../projects/utils', () => ({
  resolveTask: mocks.resolveTask,
}));

vi.mock('./conversation-events', () => ({
  conversationEvents: { _emit: mocks.emit },
}));

describe('deleteConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectLimit.mockResolvedValue([{ type: 'codex' }]);
    mocks.resolveTask.mockReturnValue(undefined);
    mocks.getProject.mockReturnValue({ ctx: {} });
    mocks.killTmuxSessionsByPtyIds.mockResolvedValue(undefined);
    mocks.deleteWhere.mockResolvedValue(undefined);
    mocks.deleteRows.mockReturnValue({ where: mocks.deleteWhere });
  });

  it('preserves the DB record when detached tmux cleanup cannot discover sessions', async () => {
    mocks.killTmuxSessionsByPtyIds.mockRejectedValue(new Error('Failed to discover tmux sessions'));

    await expect(deleteConversation('project-1', 'task-1', 'conversation-1')).rejects.toThrow(
      'Failed to discover tmux sessions'
    );

    expect(mocks.deleteRows).not.toHaveBeenCalled();
    expect(mocks.emit).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it('deletes the DB record only after detached tmux cleanup succeeds', async () => {
    await deleteConversation('project-1', 'task-1', 'conversation-1');

    expect(mocks.killTmuxSessionsByPtyIds).toHaveBeenCalledTimes(1);
    expect(mocks.deleteRows).toHaveBeenCalledTimes(1);
    expect(mocks.killTmuxSessionsByPtyIds.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteRows.mock.invocationCallOrder[0]!
    );
  });
});
