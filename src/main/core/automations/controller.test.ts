import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Automation, AutomationRun } from '@shared/automations/types';
import { automationsController } from './controller';
import {
  createAutomation,
  enqueueAutomationRun,
  getAutomation,
  getRun,
  removeRun as removeRunFromDb,
  updateAutomation,
} from './repo';
import { emitQueuedRun } from './run-transitions';

const { automationSchedulerMock } = vi.hoisted(() => ({
  automationSchedulerMock: { drainQueue: vi.fn() },
}));

vi.mock('./automation-events', () => ({
  automationEvents: { _emit: vi.fn() },
}));

vi.mock('./automation-scheduler', () => ({
  automationRunDeadline: vi.fn((_automation: Automation, scheduledAt: number) => scheduledAt + 1),
  automationScheduler: automationSchedulerMock,
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
  updateAutomation: vi.fn(),
}));

vi.mock('./service', () => ({
  setAutomationEnabled: vi.fn(),
}));

vi.mock('./run-transitions', () => ({
  emitQueuedRun: vi.fn(),
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
  deadlinePolicy: 'next-interval',
  deadlineMs: null,
  createdAt: 0,
  updatedAt: 0,
};

describe('automationsController.update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects publishing a draft when existing actions are empty', async () => {
    vi.mocked(updateAutomation).mockRejectedValue(new Error('actions_required'));

    const result = await automationsController.update(draftAutomation.id, { isDraft: false });

    expect(result).toEqual({ success: false, error: 'actions_required' });
    expect(getAutomation).not.toHaveBeenCalled();
    expect(updateAutomation).toHaveBeenCalledWith(draftAutomation.id, { isDraft: false });
  });

  it('validates existing actions when publishing without an actions patch', async () => {
    const automation = {
      ...draftAutomation,
      actions: [{ kind: 'task.create' as const, prompt: 'Do the thing' }],
      isDraft: false,
    };
    vi.mocked(updateAutomation).mockResolvedValue(automation);

    const result = await automationsController.update(draftAutomation.id, { isDraft: false });

    expect(result).toEqual({ success: true, data: automation });
    expect(getAutomation).not.toHaveBeenCalled();
    expect(updateAutomation).toHaveBeenCalledWith(draftAutomation.id, { isDraft: false });
  });

  it('rejects malformed actions with action_invalid', async () => {
    const result = await automationsController.create({
      name: 'Automation',
      description: null,
      category: 'custom',
      trigger: { expr: '0 9 * * *', tz: 'UTC' },
      actions: [{ kind: 'task.create' } as never],
      projectId: 'project-1',
    });

    expect(result).toEqual({ success: false, error: 'action_invalid:0' });
    expect(createAutomation).not.toHaveBeenCalled();
  });
});

describe('automationsController.runNow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows manually running an automation whose schedule is paused', async () => {
    const automation: Automation = {
      ...draftAutomation,
      actions: [{ kind: 'task.create' as const, prompt: 'Do the thing' }],
      enabled: false,
      isDraft: false,
    };
    const run: AutomationRun = {
      id: 'run-1',
      automationId: automation.id,
      scheduledAt: 123,
      deadlineAt: 124,
      startedAt: null,
      finishedAt: null,
      status: 'queued',
      taskId: null,
      createdTaskId: null,
      error: null,
      triggerKind: 'manual',
      workerId: null,
    };
    vi.mocked(getAutomation).mockResolvedValue(automation);
    vi.mocked(enqueueAutomationRun).mockResolvedValue(run);

    const result = await automationsController.runNow(automation.id);

    expect(result).toEqual({ success: true, data: run });
    expect(enqueueAutomationRun).toHaveBeenCalledWith(
      expect.objectContaining({
        automationId: automation.id,
        triggerKind: 'manual',
      })
    );
    expect(emitQueuedRun).toHaveBeenCalledWith(run);
    expect(automationSchedulerMock.drainQueue).toHaveBeenCalled();
  });
});

describe('automationsController.removeRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(removeRunFromDb).not.toHaveBeenCalled();
  });

  it('rejects deleting queued or running runs', async () => {
    for (const status of ['queued', 'running'] as const) {
      vi.clearAllMocks();
      vi.mocked(getRun).mockResolvedValue(makeRun({ status }));

      const result = await automationsController.removeRun('run-1');

      expect(result).toEqual({ success: false, error: 'automation_run_in_flight' });
      expect(removeRunFromDb).not.toHaveBeenCalled();
    }
  });

  it('deletes the row without touching task or worktree state', async () => {
    vi.mocked(getRun).mockResolvedValue(makeRun({ createdTaskId: null }));
    vi.mocked(removeRunFromDb).mockResolvedValue(true);

    const result = await automationsController.removeRun('run-1');

    expect(result).toEqual({ success: true, data: undefined });
    expect(removeRunFromDb).toHaveBeenCalledWith('run-1');
  });

  it('keeps the created task when removing the run row', async () => {
    vi.mocked(getRun).mockResolvedValue(makeRun({ createdTaskId: 'task-1' }));
    vi.mocked(removeRunFromDb).mockResolvedValue(true);

    const result = await automationsController.removeRun('run-1');

    expect(result).toEqual({ success: true, data: undefined });
    expect(removeRunFromDb).toHaveBeenCalledWith('run-1');
  });
});
