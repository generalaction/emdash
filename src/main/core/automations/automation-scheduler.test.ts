import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Automation } from '@shared/automations/types';
import { automationRunDeadline, AutomationScheduler } from './automation-scheduler';
import {
  claimQueuedRun,
  dueCronAutomations,
  enabledCronAutomations,
  enqueueAutomationRun,
  getNextRunAt,
  hasRunningRuns,
  listQueuedRuns,
  markRunningRunsInterrupted,
  recoverQueuedRuns,
  updateAutomationSchedule,
  updateRun,
} from './repo';
import { emitRunUpdated, runQueuedAutomation } from './runtime';

vi.mock('./automation-events', () => ({
  automationEvents: {
    on: vi.fn(() => vi.fn()),
  },
}));

vi.mock('./repo', () => ({
  claimQueuedRun: vi.fn(),
  hasRunningRuns: vi.fn(),
  dueCronAutomations: vi.fn(),
  enabledCronAutomations: vi.fn(),
  enqueueAutomationRun: vi.fn(),
  getNextRunAt: vi.fn(),
  listQueuedRuns: vi.fn(),
  markRunningRunsInterrupted: vi.fn(),
  recoverQueuedRuns: vi.fn(),
  updateAutomationSchedule: vi.fn(),
  updateRun: vi.fn(),
}));

vi.mock('./runtime', () => ({
  emitRunUpdated: vi.fn(),
  runQueuedAutomation: vi.fn(),
}));

const baseAutomation: Automation = {
  id: 'automation-1',
  name: 'Daily follow-up',
  description: null,
  category: 'custom',
  trigger: { expr: '0 9 * * *', tz: 'UTC' },
  actions: [{ kind: 'task.create', prompt: 'Check things' }],
  taskConfig: null,
  projectId: 'project-1',
  enabled: true,
  isDraft: false,
  lastRunAt: null,
  nextRunAt: null,
  builtinTemplateId: null,
  createdAt: 0,
  updatedAt: 0,
};

describe('AutomationScheduler missed runs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.mocked(recoverQueuedRuns).mockResolvedValue(0);
    vi.mocked(markRunningRunsInterrupted).mockResolvedValue(0);
    vi.mocked(enabledCronAutomations).mockResolvedValue([]);
    vi.mocked(dueCronAutomations).mockResolvedValue([]);
    vi.mocked(listQueuedRuns).mockResolvedValue([]);
    vi.mocked(claimQueuedRun).mockResolvedValue(null);
    vi.mocked(hasRunningRuns).mockResolvedValue(false);
    vi.mocked(enqueueAutomationRun).mockResolvedValue(null);
    vi.mocked(getNextRunAt).mockReturnValue(null);
    vi.mocked(updateAutomationSchedule).mockResolvedValue();
    vi.mocked(updateRun).mockResolvedValue(null);
    vi.mocked(runQueuedAutomation).mockResolvedValue({
      success: true,
      data: {
        id: 'run-1',
        automationId: baseAutomation.id,
        scheduledAt: null,
        deadlineAt: null,
        startedAt: 1,
        finishedAt: 2,
        status: 'success',
        taskId: null,
        createdTaskId: null,
        error: null,
        triggerKind: 'manual',
        workerId: 'worker-1',
      },
    });
  });

  it('queues one missed cron run with a fresh queue deadline on bootstrap', async () => {
    const now = Date.UTC(2026, 4, 15, 12, 0, 0);
    const missedScheduledAt = Date.UTC(2026, 4, 15, 9, 0, 0);
    const nextFutureRunAt = Date.UTC(2026, 4, 16, 9, 0, 0);
    const automation = { ...baseAutomation, nextRunAt: missedScheduledAt };
    vi.setSystemTime(now);
    vi.mocked(enabledCronAutomations).mockResolvedValue([automation]);
    vi.mocked(getNextRunAt).mockReturnValue(nextFutureRunAt);

    await new AutomationScheduler().reload();

    expect(enqueueAutomationRun).toHaveBeenCalledTimes(1);
    expect(enqueueAutomationRun).toHaveBeenCalledWith({
      automationId: automation.id,
      scheduledAt: missedScheduledAt,
      deadlineAt: automationRunDeadline(now),
      triggerKind: 'cron',
    });
    expect(updateAutomationSchedule).toHaveBeenCalledWith(automation.id, {
      nextRunAt: nextFutureRunAt,
    });
  });

  it('does not backfill every missed cron slot after downtime', async () => {
    const now = Date.UTC(2026, 4, 15, 12, 0, 0);
    const firstMissedScheduledAt = Date.UTC(2026, 4, 15, 8, 0, 0);
    const nextFutureRunAt = Date.UTC(2026, 4, 15, 13, 0, 0);
    const automation = { ...baseAutomation, nextRunAt: firstMissedScheduledAt };
    vi.setSystemTime(now);
    vi.mocked(enabledCronAutomations).mockResolvedValue([automation]);
    vi.mocked(getNextRunAt).mockReturnValue(nextFutureRunAt);

    await new AutomationScheduler().reload();

    expect(enqueueAutomationRun).toHaveBeenCalledTimes(1);
    expect(updateAutomationSchedule).toHaveBeenCalledTimes(1);
    expect(getNextRunAt).toHaveBeenCalledWith(automation.trigger, now);
  });

  it('marks a claimed run failed when the worker throws', async () => {
    const queuedRun = {
      id: 'run-1',
      automationId: baseAutomation.id,
      scheduledAt: Date.now(),
      deadlineAt: Date.now() + 60_000,
      startedAt: null,
      finishedAt: null,
      status: 'queued' as const,
      taskId: null,
      createdTaskId: null,
      error: null,
      triggerKind: 'manual' as const,
      workerId: null,
    };
    const runningRun = {
      ...queuedRun,
      status: 'running' as const,
      startedAt: Date.now(),
      workerId: 'worker-1',
    };
    const failedRun = {
      ...runningRun,
      status: 'failed' as const,
      finishedAt: Date.now(),
      error: 'boom',
    };
    vi.mocked(listQueuedRuns).mockResolvedValueOnce([
      { run: queuedRun, automation: baseAutomation },
    ]);
    vi.mocked(claimQueuedRun).mockResolvedValue(runningRun);
    vi.mocked(runQueuedAutomation).mockRejectedValue(new Error('boom'));
    vi.mocked(updateRun).mockResolvedValue(failedRun);

    await new AutomationScheduler().drainQueue();
    await vi.waitFor(() => {
      expect(updateRun).toHaveBeenCalledWith(runningRun.id, {
        status: 'failed',
        finishedAt: expect.any(Number),
        error: 'boom',
      });
    });

    expect(emitRunUpdated).toHaveBeenCalledWith(failedRun);
  });
});
