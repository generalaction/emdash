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
  const transaction = vi.fn((callback) => callback({ select, update }));
  return { activeLimit, activeWhere, from, select, taskLimit, taskWhere, transaction, update };
});

vi.mock('@main/db/client', () => ({
  db: {
    select: dbMock.select,
    transaction: dbMock.transaction,
    update: dbMock.update,
  },
}));

describe('convertAutomationTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.from
      .mockReturnValueOnce({ where: dbMock.taskWhere })
      .mockReturnValueOnce({ where: dbMock.activeWhere });
    dbMock.taskLimit.mockReturnValue([{ id: 'task-1' }]);
    dbMock.activeLimit.mockReturnValue([]);
  });

  it('rejects conversion while the automation run is active', async () => {
    dbMock.activeLimit.mockReturnValueOnce([{ id: 'run-1' }]);

    await expect(convertAutomationTask('task-1')).rejects.toThrow('automation_run_in_flight');

    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it('detaches automation metadata in the same transaction as the active-run guard', async () => {
    dbMock.update.mockReturnValue({
      set: vi.fn(() => ({ where: vi.fn() })),
    });

    await convertAutomationTask('task-1');

    expect(dbMock.transaction).toHaveBeenCalledOnce();
    expect(dbMock.update).toHaveBeenCalledTimes(2);
  });
});
