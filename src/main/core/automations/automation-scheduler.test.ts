import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Automation } from '@shared/automations/types';
import { automationRunDeadline, AutomationScheduler } from './automation-scheduler';
import {
  dueCronAutomations,
  enabledCronAutomations,
  enqueueAutomationRun,
  getNextRunAt,
  listQueuedRuns,
  markRunningRunsInterrupted,
  recoverQueuedRuns,
  updateAutomationSchedule,
} from './repo';

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
    vi.mocked(enqueueAutomationRun).mockResolvedValue(null);
    vi.mocked(getNextRunAt).mockReturnValue(null);
    vi.mocked(updateAutomationSchedule).mockResolvedValue();
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
});
