import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteTerminal } from './deleteTerminal';

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  deleteRows: vi.fn(),
  deleteWhere: vi.fn(),
  killTerminal: vi.fn(),
  resolveTask: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: {
    delete: mocks.deleteRows,
  },
}));

vi.mock('@main/lib/telemetry', () => ({
  telemetryService: { capture: mocks.capture },
}));

vi.mock('../projects/utils', () => ({
  resolveTask: mocks.resolveTask,
}));

describe('deleteTerminal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveTask.mockReturnValue({
      terminals: { killTerminal: mocks.killTerminal },
    });
    mocks.killTerminal.mockResolvedValue(undefined);
    mocks.deleteWhere.mockResolvedValue(undefined);
    mocks.deleteRows.mockReturnValue({ where: mocks.deleteWhere });
  });

  it('preserves the DB record when tmux cleanup fails', async () => {
    mocks.killTerminal.mockRejectedValue(new Error('Failed to discover tmux sessions'));

    await expect(
      deleteTerminal({
        projectId: 'project-1',
        taskId: 'task-1',
        terminalId: 'terminal-1',
      })
    ).rejects.toThrow('Failed to discover tmux sessions');

    expect(mocks.deleteRows).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it('deletes the DB record only after terminal cleanup succeeds', async () => {
    await deleteTerminal({
      projectId: 'project-1',
      taskId: 'task-1',
      terminalId: 'terminal-1',
    });

    expect(mocks.killTerminal).toHaveBeenCalledTimes(1);
    expect(mocks.deleteRows).toHaveBeenCalledTimes(1);
    expect(mocks.killTerminal.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteRows.mock.invocationCallOrder[0]!
    );
  });
});
