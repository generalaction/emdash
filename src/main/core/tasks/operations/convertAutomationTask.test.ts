import { beforeEach, describe, expect, it, vi } from 'vitest';
import { convertAutomationTask } from './convertAutomationTask';

const dbMock = vi.hoisted(() => {
  const taskLimit = vi.fn();
  const taskWhere = vi.fn(() => ({ limit: taskLimit }));
  const activeLimit = vi.fn();
  const activeWhere = vi.fn(() => ({ limit: activeLimit }));
  const from = vi.fn(() => ({ where: taskWhere }));
  const select = vi.fn(() => ({ from }));
  const update = vi.fn();
  return { activeLimit, activeWhere, from, select, taskLimit, taskWhere, update };
});

vi.mock('@main/db/client', () => ({
  db: {
    select: dbMock.select,
    update: dbMock.update,
  },
}));

describe('convertAutomationTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.from
      .mockReturnValueOnce({ where: dbMock.taskWhere })
      .mockReturnValueOnce({ where: dbMock.activeWhere });
    dbMock.taskLimit.mockResolvedValue([{ id: 'task-1' }]);
    dbMock.activeLimit.mockResolvedValue([]);
  });

  it('rejects conversion while the automation run is active', async () => {
    dbMock.activeLimit.mockResolvedValueOnce([{ id: 'run-1' }]);

    await expect(convertAutomationTask('task-1')).rejects.toThrow('automation_run_in_flight');

    expect(dbMock.update).not.toHaveBeenCalled();
  });
});
