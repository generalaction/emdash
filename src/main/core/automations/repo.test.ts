import { beforeEach, describe, expect, it, vi } from 'vitest';
import { automationRuns, automations } from '@main/db/schema';
import { automationRunUpdatedChannel } from '@shared/events/automationEvents';
import {
  claimQueuedRun,
  enqueueAutomationRun,
  listRecentRuns,
  listRuns,
  taskWasCreatedByAutomationRun,
  updateAutomation,
} from './repo';
import { detachProject, setAutomationEnabled } from './service';

const dbMock = vi.hoisted(() => {
  const rowsResult = <T>(rows: T[]) =>
    Object.assign([...rows], {
      all: () => rows,
      get: () => rows[0],
    });
  const selectLimit = vi.fn<() => unknown>();
  const selectWhere = vi.fn<() => unknown>(() => ({ limit: selectLimit }));
  const selectFrom = vi.fn<() => unknown>(() => ({ where: selectWhere }));
  const select = vi.fn<() => unknown>(() => ({ from: selectFrom }));
  const updateReturning = vi.fn();
  const updateWhere = vi.fn(() => ({ returning: updateReturning }));
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));
  const all = vi.fn();
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
    all,
    transaction,
  };
});

vi.mock('@main/db/client', () => ({
  db: {
    select: dbMock.select,
    update: dbMock.update,
    all: dbMock.all,
    transaction: dbMock.transaction,
  },
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
    dbMock.all.mockReturnValue([]);
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
      startedAt: null,
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
      startedAt: null,
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

  it('validates final trigger inside updateAutomation', async () => {
    dbMock.selectLimit.mockReturnValueOnce(dbMock.rowsResult([automationRow]));

    await expect(
      updateAutomation('automation-1', { trigger: { expr: 'not cron', tz: 'UTC' } })
    ).rejects.toThrow('cron_invalid');

    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it('validates final deadline inside updateAutomation', async () => {
    dbMock.selectLimit.mockReturnValueOnce(dbMock.rowsResult([automationRow]));

    await expect(updateAutomation('automation-1', { deadlineMs: 0 })).rejects.toThrow(
      'deadline_ms_invalid'
    );

    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it('allows clearing an existing deadline inside updateAutomation', async () => {
    dbMock.selectLimit.mockReturnValueOnce(
      dbMock.rowsResult([{ ...automationRow, deadlinePolicy: 'fixed', deadlineMs: 1000 }])
    );
    dbMock.updateReturning.mockReturnValueOnce(
      dbMock.rowsResult([{ ...automationRow, deadlineMs: null }])
    );

    await expect(updateAutomation('automation-1', { deadlineMs: null })).resolves.toEqual(
      expect.objectContaining({ id: 'automation-1', deadlineMs: null })
    );

    expect(dbMock.updateSet).toHaveBeenCalledWith({
      deadlineMs: null,
      updatedAt: expect.any(Number),
    });
  });

  it('rejects enabling a draft inside updateAutomation', async () => {
    dbMock.selectLimit.mockReturnValueOnce(dbMock.rowsResult([{ ...automationRow, isDraft: 1 }]));

    await expect(updateAutomation('automation-1', { enabled: true })).rejects.toThrow(
      'automation_is_draft'
    );

    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it('rejects enabling a detached automation inside updateAutomation', async () => {
    dbMock.selectLimit.mockReturnValueOnce(
      dbMock.rowsResult([{ ...automationRow, enabled: 0, projectId: null }])
    );

    await expect(updateAutomation('automation-1', { enabled: true })).rejects.toThrow(
      'no_project_attached'
    );

    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it('refreshes nextRunAt when updateAutomation enables a paused automation', async () => {
    dbMock.selectLimit.mockReturnValueOnce(
      dbMock.rowsResult([{ ...automationRow, enabled: 0, nextRunAt: null }])
    );
    dbMock.updateReturning.mockReturnValueOnce(
      dbMock.rowsResult([{ ...automationRow, enabled: 1, nextRunAt: 999 }])
    );

    await expect(updateAutomation('automation-1', { enabled: true })).resolves.toEqual(
      expect.objectContaining({ id: 'automation-1', enabled: true, nextRunAt: 999 })
    );

    expect(dbMock.updateSet).toHaveBeenCalledWith({
      enabled: 1,
      nextRunAt: expect.any(Number),
      updatedAt: expect.any(Number),
    });
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

  it('enqueues a run with a guarded insert', async () => {
    dbMock.all.mockReturnValueOnce([{ ...runRow, status: 'queued', finishedAt: null }]);

    await expect(
      enqueueAutomationRun({
        automationId: 'automation-1',
        scheduledAt: 100,
        deadlineAt: null,
        triggerKind: 'cron',
      })
    ).resolves.toEqual(expect.objectContaining({ id: 'run-1', status: 'queued' }));

    expect(dbMock.all).toHaveBeenCalledTimes(1);
  });

  it('returns null when the guarded enqueue does not insert', async () => {
    dbMock.all.mockReturnValueOnce([]);

    await expect(
      enqueueAutomationRun({
        automationId: 'automation-1',
        scheduledAt: 100,
        deadlineAt: null,
        triggerKind: 'cron',
      })
    ).resolves.toBeNull();
  });

  it('claims a run only through the guarded update', async () => {
    dbMock.all.mockReturnValueOnce([
      { ...runRow, status: 'running', startedAt: 300, finishedAt: null, workerId: 'worker-1' },
    ]);

    await expect(claimQueuedRun('run-1', 'worker-1', 300)).resolves.toEqual(
      expect.objectContaining({ id: 'run-1', status: 'running', workerId: 'worker-1' })
    );

    expect(dbMock.all).toHaveBeenCalledTimes(1);
  });

  it('identifies automation tasks after createdTaskId is cleared', async () => {
    dbMock.selectLimit.mockReturnValueOnce(dbMock.rowsResult([{ id: 'run-1' }]));

    await expect(taskWasCreatedByAutomationRun('task-2')).resolves.toBe(true);
  });

  it('hydrates run agent provider from the created task conversation', async () => {
    const runWithTask = {
      ...runRow,
      status: 'success',
      taskId: 'task-1',
      createdTaskId: 'task-1',
      error: null,
    };
    const currentAutomationProvider = {
      id: automationRow.id,
      taskConfig: JSON.stringify({ initialConversation: { provider: 'cursor' } }),
    };
    const conversationProvider = {
      taskId: 'task-1',
      provider: 'claude',
      isInitialConversation: true,
      createdAt: '2026-01-01 00:00:00',
    };

    dbMock.selectFrom
      .mockReturnValueOnce({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => dbMock.rowsResult([runWithTask])),
          })),
        })),
      })
      .mockReturnValueOnce({
        where: vi.fn(() => ({
          limit: vi.fn(() => dbMock.rowsResult([currentAutomationProvider])),
        })),
      })
      .mockReturnValueOnce({
        where: vi.fn(() => dbMock.rowsResult([conversationProvider])),
      });

    await expect(listRuns('automation-1')).resolves.toEqual([
      expect.objectContaining({ id: 'run-1', agentProviderId: 'claude' }),
    ]);
  });

  it('hydrates recent run agent provider from the created task conversation', async () => {
    const runWithTask = {
      ...runRow,
      status: 'success',
      taskId: 'task-1',
      createdTaskId: 'task-1',
      error: null,
    };
    const automationWithCurrentProvider = {
      ...automationRow,
      taskConfig: JSON.stringify({ initialConversation: { provider: 'cursor' } }),
    };
    const conversationProvider = {
      taskId: 'task-1',
      provider: 'claude',
      isInitialConversation: true,
      createdAt: '2026-01-01 00:00:00',
    };

    dbMock.selectFrom
      .mockReturnValueOnce({
        innerJoin: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(() =>
              dbMock.rowsResult([{ run: runWithTask, automation: automationWithCurrentProvider }])
            ),
          })),
        })),
      })
      .mockReturnValueOnce({
        where: vi.fn(() => dbMock.rowsResult([conversationProvider])),
      });

    await expect(listRecentRuns(undefined)).resolves.toEqual([
      expect.objectContaining({ id: 'run-1', agentProviderId: 'claude' }),
    ]);
  });
});
