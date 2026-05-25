import { beforeEach, describe, expect, it, vi } from 'vitest';
import { automationRuns, automations } from '@main/db/schema';
import { automationRunUpdatedChannel } from '@shared/events/automationEvents';
import { updateAutomation } from './repo';
import { detachProject, setAutomationEnabled } from './service';

const dbMock = vi.hoisted(() => {
  const rowsResult = <T>(rows: T[]) =>
    Object.assign([...rows], {
      all: () => rows,
      get: () => rows[0],
    });
  const selectLimit = vi.fn();
  const selectWhere = vi.fn(() => ({ limit: selectLimit }));
  const selectFrom = vi.fn(() => ({ where: selectWhere }));
  const select = vi.fn(() => ({ from: selectFrom }));
  const updateReturning = vi.fn();
  const updateWhere = vi.fn(() => ({ returning: updateReturning }));
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));
  const transaction = vi.fn((callback) => {
    const result = callback({ select, update });
    if (result && typeof result.then === 'function') {
      throw new Error('Transaction function cannot return a promise');
    }
    return result;
  });
  return {
    rowsResult,
    select,
    selectFrom,
    selectWhere,
    selectLimit,
    update,
    updateReturning,
    updateSet,
    updateWhere,
    transaction,
  };
});

vi.mock('@main/db/client', () => ({
  db: { select: dbMock.select, update: dbMock.update, transaction: dbMock.transaction },
}));

vi.mock('@main/lib/events', () => ({
  events: { emit: vi.fn() },
}));

vi.mock('@main/lib/logger', () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const automationRow = {
  id: 'automation-1',
  name: 'Automation',
  description: null,
  category: 'custom',
  cronExpr: '0 9 * * *',
  cronTz: 'UTC',
  promptTemplate: 'Do the thing',
  actions: JSON.stringify([{ kind: 'task.create', prompt: 'Do the thing' }]),
  taskConfig: null,
  projectId: 'project-1',
  enabled: 1,
  isDraft: 0,
  lastRunAt: null,
  nextRunAt: 123,
  builtinTemplateId: null,
  deadlinePolicy: 'next-interval',
  deadlineMs: null,
  createdAt: 1,
  updatedAt: 1,
};

const runRow = {
  id: 'run-1',
  automationId: 'automation-1',
  scheduledAt: 100,
  deadlineAt: null,
  startedAt: null,
  finishedAt: 200,
  status: 'skipped',
  taskId: null,
  createdTaskId: null,
  error: 'automation_disabled',
  triggerKind: 'cron',
  workerId: null,
};

describe('automations repo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.selectLimit.mockReturnValue(dbMock.rowsResult([automationRow]));
    dbMock.updateReturning.mockReturnValue(dbMock.rowsResult([]));
  });

  it('detaches every automation for a project', async () => {
    dbMock.updateReturning
      .mockReturnValueOnce(dbMock.rowsResult([{ id: 'automation-1' }, { id: 'automation-2' }]))
      .mockReturnValueOnce(dbMock.rowsResult([{ ...runRow, error: 'no_project_attached' }]))
      .mockReturnValueOnce(dbMock.rowsResult([]));

    await expect(detachProject('project-1')).resolves.toBe(2);

    expect(dbMock.update).toHaveBeenNthCalledWith(1, automations);
    expect(dbMock.updateSet).toHaveBeenNthCalledWith(1, {
      projectId: null,
      nextRunAt: null,
      updatedAt: expect.any(Number),
    });
    expect(dbMock.updateReturning).toHaveBeenCalledWith({ id: automations.id });
    expect(dbMock.update).toHaveBeenCalledWith(automationRuns);
    expect(dbMock.updateSet).toHaveBeenCalledWith({
      status: 'skipped',
      finishedAt: expect.any(Number),
      error: 'no_project_attached',
      workerId: null,
    });
    const { events } = await import('@main/lib/events');
    expect(events.emit).toHaveBeenCalledWith(automationRunUpdatedChannel, {
      automationId: 'automation-1',
      runId: 'run-1',
      status: 'skipped',
      taskId: null,
    });
  });

  it('skips queued cron runs when disabling an automation', async () => {
    dbMock.updateReturning
      .mockReturnValueOnce(dbMock.rowsResult([{ ...automationRow, enabled: 0 }]))
      .mockReturnValueOnce(dbMock.rowsResult([runRow]));

    await expect(setAutomationEnabled('automation-1', false)).resolves.toEqual(
      expect.objectContaining({ id: 'automation-1', enabled: false })
    );

    expect(dbMock.update).toHaveBeenNthCalledWith(1, automations);
    expect(dbMock.updateSet).toHaveBeenNthCalledWith(1, {
      enabled: 0,
      nextRunAt: 123,
      updatedAt: expect.any(Number),
    });
    expect(dbMock.update).toHaveBeenNthCalledWith(2, automationRuns);
    expect(dbMock.updateSet).toHaveBeenNthCalledWith(2, {
      status: 'skipped',
      finishedAt: expect.any(Number),
      error: 'automation_disabled',
      workerId: null,
    });
    const { events } = await import('@main/lib/events');
    expect(events.emit).toHaveBeenCalledWith(automationRunUpdatedChannel, {
      automationId: 'automation-1',
      runId: 'run-1',
      status: 'skipped',
      taskId: null,
    });
  });

  it('validates final actions inside updateAutomation', async () => {
    dbMock.selectLimit.mockReturnValueOnce(
      dbMock.rowsResult([{ ...automationRow, actions: '[]', promptTemplate: '' }])
    );

    await expect(updateAutomation('automation-1', { isDraft: false })).rejects.toThrow(
      'actions_required'
    );

    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it('updates when final published actions are valid', async () => {
    dbMock.selectLimit.mockReturnValueOnce(dbMock.rowsResult([{ ...automationRow, isDraft: 1 }]));
    dbMock.updateReturning.mockReturnValueOnce(
      dbMock.rowsResult([{ ...automationRow, isDraft: 0 }])
    );

    await expect(updateAutomation('automation-1', { isDraft: false })).resolves.toEqual(
      expect.objectContaining({ id: 'automation-1', isDraft: false })
    );

    expect(dbMock.update).toHaveBeenCalledWith(automations);
    expect(dbMock.updateSet).toHaveBeenCalledWith({ isDraft: 0, updatedAt: expect.any(Number) });
  });
});
