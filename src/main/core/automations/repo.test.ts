import { beforeEach, describe, expect, it, vi } from 'vitest';
import { automationRuns, automations } from '@main/db/schema';
import { detachProject, setAutomationEnabled } from './repo';

const dbMock = vi.hoisted(() => {
  const selectLimit = vi.fn();
  const selectWhere = vi.fn(() => ({ limit: selectLimit }));
  const selectFrom = vi.fn(() => ({ where: selectWhere }));
  const select = vi.fn(() => ({ from: selectFrom }));
  const updateReturning = vi.fn();
  const updateWhere = vi.fn(() => ({ returning: updateReturning }));
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));
  return {
    select,
    selectFrom,
    selectWhere,
    selectLimit,
    update,
    updateReturning,
    updateSet,
    updateWhere,
  };
});

vi.mock('@main/db/client', () => ({
  db: { select: dbMock.select, update: dbMock.update },
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

describe('automations repo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.selectLimit.mockResolvedValue([automationRow]);
    dbMock.updateReturning.mockResolvedValue([{ id: 'automation-1' }, { id: 'automation-2' }]);
  });

  it('detaches every automation for a project', async () => {
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
  });

  it('skips queued cron runs when disabling an automation', async () => {
    dbMock.updateReturning.mockResolvedValueOnce([{ ...automationRow, enabled: 0 }]);

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
  });
});
