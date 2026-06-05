import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Automation, AutomationRun } from '@shared/automations/types';
import { executeTaskCreate } from './actions/taskCreate';
import { automationEvents } from './automation-events';
import { updateAutomationSchedule, updateRun } from './repo';
import { runQueuedAutomation } from './runtime';

vi.mock('@main/lib/events', () => ({ events: { emit: vi.fn() } }));
vi.mock('@main/lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('./actions/taskCreate', () => ({ executeTaskCreate: vi.fn() }));
vi.mock('./automation-events', () => ({ automationEvents: { _emit: vi.fn() } }));
vi.mock('./repo', () => ({ updateAutomationSchedule: vi.fn(), updateRun: vi.fn() }));

const automation: Automation = {
  id: 'automation-1',
  name: 'Daily follow-up',
  description: null,
  category: 'custom',
  trigger: { kind: 'cron' as const, expr: '0 9 * * *', tz: 'UTC' },
  actions: [{ kind: 'task.create', prompt: 'Check things' }],
  taskConfig: null,
  projectId: 'project-1',
  enabled: true,
  isDraft: false,
  lastRunAt: null,
  nextRunAt: null,
  deadlinePolicy: 'next-interval',
  deadlineMs: null,
  createdAt: 0,
  updatedAt: 0,
};

const run: AutomationRun = {
  id: 'run-1',
  automationId: automation.id,
  scheduledAt: null,
  deadlineAt: null,
  startedAt: 1,
  finishedAt: null,
  status: 'running',
  taskId: null,
  createdTaskId: null,
  error: null,
  triggerKind: 'manual',
  workerId: 'worker-1',
};

describe('runQueuedAutomation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(updateRun).mockImplementation(async (_, values) => ({ ...run, ...values }));
    vi.mocked(updateAutomationSchedule).mockResolvedValue(undefined as never);
  });

  it('marks a successful run and stores the created task id', async () => {
    vi.mocked(executeTaskCreate).mockResolvedValue({ success: true, data: { taskId: 'task-1' } });

    const result = await runQueuedAutomation(automation, run);

    expect(result.success).toBe(true);
    expect(executeTaskCreate).toHaveBeenCalledWith(automation.actions[0], {
      automation,
      run,
    });
    expect(updateRun).toHaveBeenCalledWith(run.id, {
      status: 'success',
      finishedAt: expect.any(Number),
      taskId: 'task-1',
      createdTaskId: 'task-1',
    });
    expect(updateAutomationSchedule).toHaveBeenCalledWith(automation.id, { lastRunAt: 1 });
    expect(automationEvents._emit).toHaveBeenCalledWith('automation:run:finish', {
      ...run,
      status: 'success',
      finishedAt: expect.any(Number),
      taskId: 'task-1',
      createdTaskId: 'task-1',
      error: null,
    });
  });

  it('skips automations with no actions', async () => {
    const noActionAutomation = { ...automation, actions: [] };
    const skippedRun = {
      ...run,
      status: 'skipped' as const,
      finishedAt: Date.now(),
      error: 'no_actions_configured',
    };
    vi.mocked(updateRun).mockResolvedValue(skippedRun);

    const result = await runQueuedAutomation(noActionAutomation, run);

    expect(result).toEqual({ success: true, data: skippedRun });
    expect(executeTaskCreate).not.toHaveBeenCalled();
    expect(updateRun).toHaveBeenCalledWith(run.id, {
      status: 'skipped',
      finishedAt: expect.any(Number),
      error: 'no_actions_configured',
    });
    expect(automationEvents._emit).toHaveBeenCalledWith('automation:run:skipped', skippedRun);
  });

  it('runs multiple actions and keeps the first created task id while linking the latest task', async () => {
    const multiActionAutomation = {
      ...automation,
      actions: [
        { kind: 'task.create' as const, prompt: 'First' },
        { kind: 'task.create' as const, prompt: 'Second' },
      ],
    };
    vi.mocked(executeTaskCreate)
      .mockResolvedValueOnce({ success: true, data: { taskId: 'task-1' } })
      .mockResolvedValueOnce({ success: true, data: { taskId: 'task-2' } });

    const result = await runQueuedAutomation(multiActionAutomation, run);

    expect(result.success).toBe(true);
    expect(executeTaskCreate).toHaveBeenCalledTimes(2);
    expect(updateRun).toHaveBeenLastCalledWith(run.id, {
      status: 'success',
      finishedAt: expect.any(Number),
      taskId: 'task-2',
      createdTaskId: 'task-1',
    });
  });

  it('uses the first created task id when a later action fails', async () => {
    const multiActionAutomation = {
      ...automation,
      actions: [
        { kind: 'task.create' as const, prompt: 'First' },
        { kind: 'task.create' as const, prompt: 'Second' },
      ],
    };
    vi.mocked(executeTaskCreate)
      .mockResolvedValueOnce({ success: true, data: { taskId: 'task-1' } })
      .mockResolvedValueOnce({ success: false, error: { message: 'second_failed' } });

    const result = await runQueuedAutomation(multiActionAutomation, run);

    expect(result).toEqual({ success: false, error: 'second_failed' });
    expect(updateRun).toHaveBeenLastCalledWith(run.id, {
      status: 'failed',
      finishedAt: expect.any(Number),
      taskId: 'task-1',
      createdTaskId: 'task-1',
      error: 'second_failed',
    });
  });

  it('captures thrown action errors', async () => {
    vi.mocked(executeTaskCreate).mockRejectedValue(new Error('boom'));

    const result = await runQueuedAutomation(automation, run);

    expect(result).toEqual({ success: false, error: 'boom' });
    expect(updateRun).toHaveBeenCalledWith(run.id, {
      status: 'failed',
      finishedAt: expect.any(Number),
      taskId: null,
      createdTaskId: null,
      error: 'boom',
    });
    expect(automationEvents._emit).toHaveBeenCalledWith(
      'automation:run:failed',
      expect.objectContaining({ status: 'failed', error: 'boom' })
    );
  });

  it('skips orphan automations before executing actions', async () => {
    const skippedRun = {
      ...run,
      status: 'skipped' as const,
      finishedAt: Date.now(),
      error: 'no_project_attached',
    };
    vi.mocked(updateRun).mockResolvedValue(skippedRun);

    const result = await runQueuedAutomation({ ...automation, projectId: null }, run);

    expect(result).toEqual({ success: false, error: 'no_project_attached' });
    expect(executeTaskCreate).not.toHaveBeenCalled();
    expect(updateRun).toHaveBeenCalledWith(run.id, {
      status: 'skipped',
      finishedAt: expect.any(Number),
      error: 'no_project_attached',
    });
    expect(automationEvents._emit).toHaveBeenCalledWith('automation:run:skipped', skippedRun);
  });

  it('does not attach a task id when task creation fails before a task exists', async () => {
    vi.mocked(executeTaskCreate).mockResolvedValue({
      success: false,
      error: { message: 'project_not_found' },
    });

    const result = await runQueuedAutomation(automation, run);

    expect(result).toEqual({ success: false, error: 'project_not_found' });
    expect(updateRun).toHaveBeenCalledWith(run.id, {
      status: 'failed',
      finishedAt: expect.any(Number),
      taskId: null,
      createdTaskId: null,
      error: 'project_not_found',
    });
    expect(automationEvents._emit).toHaveBeenCalledWith('automation:run:failed', {
      ...run,
      status: 'failed',
      finishedAt: expect.any(Number),
      taskId: null,
      createdTaskId: null,
      error: 'project_not_found',
    });
  });
});
