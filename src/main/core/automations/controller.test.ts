import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Automation, AutomationRun } from '@shared/automations/types';
import { automationsController } from './controller';
import { getAutomation, getRun, removeRun as removeRunFromDb, updateAutomation } from './repo';

const { dbSelectMock, deleteTaskMock } = vi.hoisted(() => ({
  dbSelectMock: vi.fn(),
  deleteTaskMock: vi.fn(),
}));
vi.mock('@main/db/client', () => ({
  db: {
    select: (...args: unknown[]) => dbSelectMock(...args),
  },
}));
vi.mock('@main/db/schema', () => ({ tasks: { id: 'id', projectId: 'projectId' } }));
vi.mock('@main/lib/logger', () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@main/core/tasks/operations/deleteTask', () => ({ deleteTask: deleteTaskMock }));

vi.mock('./automation-events', () => ({
  automationEvents: { _emit: vi.fn() },
}));

vi.mock('./automation-scheduler', () => ({
  automationRunDeadline: vi.fn((scheduledAt: number) => scheduledAt + 1),
  automationScheduler: { drainQueue: vi.fn() },
}));

vi.mock('./repo', () => ({
  createAutomation: vi.fn(),
  enqueueAutomationRun: vi.fn(),
  getAutomation: vi.fn(),
  getRun: vi.fn(),
  listAutomations: vi.fn(),
  listRecentRuns: vi.fn(),
  listRuns: vi.fn(),
  removeAutomation: vi.fn(),
  removeRun: vi.fn(),
  setAutomationEnabled: vi.fn(),
  updateAutomation: vi.fn(),
}));

vi.mock('./runtime', () => ({
  emitRunUpdated: vi.fn(),
}));

const draftAutomation: Automation = {
  id: 'automation-1',
  name: 'Draft automation',
  description: null,
  category: 'custom',
  trigger: { expr: '0 9 * * *', tz: 'UTC' },
  actions: [],
  taskConfig: null,
  projectId: 'project-1',
  enabled: false,
  isDraft: true,
  lastRunAt: null,
  nextRunAt: null,
  builtinTemplateId: null,
  createdAt: 0,
  updatedAt: 0,
};

describe('automationsController.update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects publishing a draft when existing actions are empty', async () => {
    vi.mocked(getAutomation).mockResolvedValue(draftAutomation);

    const result = await automationsController.update(draftAutomation.id, { isDraft: false });

    expect(result).toEqual({ success: false, error: 'actions_required' });
    expect(updateAutomation).not.toHaveBeenCalled();
  });

  it('validates existing actions when publishing without an actions patch', async () => {
    const automation = {
      ...draftAutomation,
      actions: [{ kind: 'task.create' as const, prompt: 'Do the thing' }],
      isDraft: false,
    };
    vi.mocked(getAutomation).mockResolvedValue({ ...automation, isDraft: true });
    vi.mocked(updateAutomation).mockResolvedValue(automation);

    const result = await automationsController.update(draftAutomation.id, { isDraft: false });

    expect(result).toEqual({ success: true, data: automation });
    expect(updateAutomation).toHaveBeenCalledWith(draftAutomation.id, { isDraft: false });
  });
});

describe('automationsController.removeRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteTaskMock.mockReset();
    dbSelectMock.mockReset();
  });

  function makeRun(overrides: Partial<AutomationRun> = {}): AutomationRun {
    return {
      id: 'run-1',
      automationId: 'automation-1',
      scheduledAt: null,
      deadlineAt: null,
      startedAt: null,
      finishedAt: null,
      status: 'success',
      taskId: null,
      createdTaskId: null,
      error: null,
      triggerKind: 'manual',
      workerId: null,
      ...overrides,
    };
  }

  it('returns automation_run_not_found when the run does not exist', async () => {
    vi.mocked(getRun).mockResolvedValue(null);

    const result = await automationsController.removeRun('missing-run');

    expect(result).toEqual({ success: false, error: 'automation_run_not_found' });
    expect(deleteTaskMock).not.toHaveBeenCalled();
    expect(removeRunFromDb).not.toHaveBeenCalled();
  });

  it('deletes the row without touching tasks when the run created no task', async () => {
    vi.mocked(getRun).mockResolvedValue(makeRun({ createdTaskId: null }));
    vi.mocked(removeRunFromDb).mockResolvedValue(true);

    const result = await automationsController.removeRun('run-1');

    expect(result).toEqual({ success: true, data: undefined });
    expect(deleteTaskMock).not.toHaveBeenCalled();
    expect(removeRunFromDb).toHaveBeenCalledWith('run-1');
  });

  it('tears down the created task before removing the run row', async () => {
    vi.mocked(getRun).mockResolvedValue(makeRun({ createdTaskId: 'task-1' }));
    vi.mocked(removeRunFromDb).mockResolvedValue(true);
    dbSelectMock.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{ projectId: 'project-1' }]),
        }),
      }),
    });

    const result = await automationsController.removeRun('run-1');

    expect(result).toEqual({ success: true, data: undefined });
    expect(deleteTaskMock).toHaveBeenCalledWith('project-1', 'task-1');
    expect(removeRunFromDb).toHaveBeenCalledWith('run-1');
  });

  it('still removes the run row when the underlying task is already gone', async () => {
    vi.mocked(getRun).mockResolvedValue(makeRun({ createdTaskId: 'task-1' }));
    vi.mocked(removeRunFromDb).mockResolvedValue(true);
    dbSelectMock.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      }),
    });

    const result = await automationsController.removeRun('run-1');

    expect(result).toEqual({ success: true, data: undefined });
    expect(deleteTaskMock).not.toHaveBeenCalled();
    expect(removeRunFromDb).toHaveBeenCalledWith('run-1');
  });

  it('keeps the run row when deleteTask throws', async () => {
    vi.mocked(getRun).mockResolvedValue(makeRun({ createdTaskId: 'task-1' }));
    dbSelectMock.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{ projectId: 'project-1' }]),
        }),
      }),
    });
    deleteTaskMock.mockRejectedValue(new Error('boom'));

    const result = await automationsController.removeRun('run-1');

    expect(result).toEqual({ success: false, error: 'task_delete_failed' });
    expect(removeRunFromDb).not.toHaveBeenCalled();
  });
});
