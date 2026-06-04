import { beforeEach, describe, expect, it, vi } from 'vitest';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import type { Automation, AutomationRun } from '@shared/automations/types';
import { automationRunUpdatedChannel } from '@shared/events/automationEvents';
import { automationEvents } from './automation-events';
import { AutomationScheduler } from './automation-scheduler';
import {
  claimQueuedRun,
  dueQueuedCronRuns,
  enabledAutomationsWithoutQueuedRun,
  ensureNextCronRun,
  hasRunningRuns,
  listRunningRunsForRecovery,
  listQueuedRuns,
  recoverQueuedRuns,
  taskExists,
  updateRun,
} from './repo';
import { runQueuedAutomation } from './runtime';

vi.mock('@main/lib/events', () => ({ events: { emit: vi.fn() } }));
vi.mock('@main/lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

vi.mock('./automation-events', () => ({
  automationEvents: {
    on: vi.fn(() => vi.fn()),
    _emit: vi.fn(),
  },
}));

vi.mock('./repo', () => ({
  claimQueuedRun: vi.fn(),
  hasRunningRuns: vi.fn(),
  dueQueuedCronRuns: vi.fn(),
  enabledAutomationsWithoutQueuedRun: vi.fn(),
  ensureNextCronRun: vi.fn(),
  listRunningRunsForRecovery: vi.fn(),
  listQueuedRuns: vi.fn(),
  recoverQueuedRuns: vi.fn(),
  taskExists: vi.fn(),
  updateRun: vi.fn(),
}));

vi.mock('./runtime', () => ({
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
  deadlinePolicy: 'next-interval',
  deadlineMs: null,
  createdAt: 0,
  updatedAt: 0,
};

describe('AutomationScheduler bootstrap', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.mocked(recoverQueuedRuns).mockResolvedValue(0);
    vi.mocked(listRunningRunsForRecovery).mockResolvedValue([]);
    vi.mocked(taskExists).mockResolvedValue(false);
    vi.mocked(enabledAutomationsWithoutQueuedRun).mockResolvedValue([]);
    vi.mocked(dueQueuedCronRuns).mockResolvedValue([]);
    vi.mocked(listQueuedRuns).mockResolvedValue([]);
    vi.mocked(claimQueuedRun).mockResolvedValue(null);
    vi.mocked(hasRunningRuns).mockResolvedValue(false);
    vi.mocked(ensureNextCronRun).mockResolvedValue(null);
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

  it('calls ensureNextCronRun for each automation without a queued run', async () => {
    vi.mocked(enabledAutomationsWithoutQueuedRun).mockResolvedValue([baseAutomation]);

    await new AutomationScheduler().reload();

    expect(ensureNextCronRun).toHaveBeenCalledWith(baseAutomation, expect.any(Number));
  });

  it('calls ensureNextCronRun for the next interval when a due run is dispatched', async () => {
    const now = Date.UTC(2026, 4, 15, 12, 0, 0);
    const dueRun: AutomationRun = {
      id: 'run-1',
      automationId: baseAutomation.id,
      scheduledAt: Date.UTC(2026, 4, 15, 9, 0, 0),
      deadlineAt: null,
      startedAt: null,
      finishedAt: null,
      status: 'queued',
      taskId: null,
      createdTaskId: null,
      error: null,
      triggerKind: 'cron',
      workerId: null,
    };
    vi.setSystemTime(now);
    vi.mocked(dueQueuedCronRuns).mockResolvedValue([{ run: dueRun, automation: baseAutomation }]);

    await new AutomationScheduler().reload();

    expect(ensureNextCronRun).toHaveBeenCalledWith(baseAutomation, now);
  });

  it('does not backfill multiple missed slots — only dispatches the one due run', async () => {
    const now = Date.UTC(2026, 4, 15, 12, 0, 0);
    const dueRun: AutomationRun = {
      id: 'run-1',
      automationId: baseAutomation.id,
      scheduledAt: Date.UTC(2026, 4, 15, 8, 0, 0),
      deadlineAt: null,
      startedAt: null,
      finishedAt: null,
      status: 'queued',
      taskId: null,
      createdTaskId: null,
      error: null,
      triggerKind: 'cron',
      workerId: null,
    };
    vi.setSystemTime(now);
    vi.mocked(dueQueuedCronRuns).mockResolvedValue([{ run: dueRun, automation: baseAutomation }]);

    await new AutomationScheduler().reload();

    expect(ensureNextCronRun).toHaveBeenCalledTimes(1);
    expect(ensureNextCronRun).toHaveBeenCalledWith(baseAutomation, now);
  });

  it('serializes overlapping reloads and re-runs bootstrap once', async () => {
    let finishFirstBootstrap: ((value: Automation[]) => void) | undefined;
    vi.mocked(enabledAutomationsWithoutQueuedRun)
      .mockImplementationOnce(
        () =>
          new Promise<Automation[]>((resolve) => {
            finishFirstBootstrap = resolve;
          })
      )
      .mockResolvedValue([]);

    const scheduler = new AutomationScheduler();
    const firstReload = scheduler.reload();
    const secondReload = scheduler.reload();

    await vi.waitFor(() => expect(finishFirstBootstrap).toBeDefined());
    expect(enabledAutomationsWithoutQueuedRun).toHaveBeenCalledTimes(1);
    finishFirstBootstrap?.([]);
    await Promise.all([firstReload, secondReload]);

    expect(enabledAutomationsWithoutQueuedRun).toHaveBeenCalledTimes(2);
  });

  it('logs bootstrap failures without rejecting fire-and-forget reload callers', async () => {
    vi.mocked(enabledAutomationsWithoutQueuedRun).mockRejectedValueOnce(new Error('db failed'));

    await expect(new AutomationScheduler().reload()).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalledWith('AutomationScheduler bootstrap failed', {
      error: 'Error: db failed',
    });
  });

  it('skips orphan automations without claiming a worker', async () => {
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
    const skippedRun = {
      ...queuedRun,
      status: 'skipped' as const,
      finishedAt: Date.now(),
      error: 'no_project_attached',
    };
    vi.mocked(listQueuedRuns).mockResolvedValueOnce([
      { run: queuedRun, automation: { ...baseAutomation, projectId: null } },
    ]);
    vi.mocked(updateRun).mockResolvedValue(skippedRun);

    await new AutomationScheduler().drainQueue();

    expect(updateRun).toHaveBeenCalledWith(queuedRun.id, {
      status: 'skipped',
      finishedAt: expect.any(Number),
      error: 'no_project_attached',
    });
    expect(claimQueuedRun).not.toHaveBeenCalled();
    expect(runQueuedAutomation).not.toHaveBeenCalled();
    expect(events.emit).toHaveBeenCalledWith(
      automationRunUpdatedChannel,
      expect.objectContaining({
        automationId: skippedRun.automationId,
        runId: skippedRun.id,
        status: skippedRun.status,
        taskId: skippedRun.taskId,
      })
    );
    expect(automationEvents._emit).toHaveBeenCalledWith('automation:run:skipped', skippedRun);
  });

  it('skips a cron run when the same automation already has a running run', async () => {
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
      triggerKind: 'cron' as const,
      workerId: null,
    };
    const skippedRun = {
      ...queuedRun,
      status: 'skipped' as const,
      finishedAt: Date.now(),
      error: 'previous_still_running',
    };
    vi.mocked(listQueuedRuns).mockResolvedValueOnce([
      { run: queuedRun, automation: baseAutomation },
    ]);
    vi.mocked(hasRunningRuns).mockResolvedValue(true);
    vi.mocked(updateRun).mockResolvedValue(skippedRun);

    await new AutomationScheduler().drainQueue();

    expect(hasRunningRuns).toHaveBeenCalledWith(baseAutomation.id);
    expect(updateRun).toHaveBeenCalledWith(queuedRun.id, {
      status: 'skipped',
      finishedAt: expect.any(Number),
      error: 'previous_still_running',
    });
    expect(claimQueuedRun).not.toHaveBeenCalled();
    expect(runQueuedAutomation).not.toHaveBeenCalled();
    expect(events.emit).toHaveBeenCalledWith(
      automationRunUpdatedChannel,
      expect.objectContaining({
        automationId: skippedRun.automationId,
        runId: skippedRun.id,
        status: skippedRun.status,
        taskId: skippedRun.taskId,
      })
    );
    expect(automationEvents._emit).toHaveBeenCalledWith('automation:run:skipped', skippedRun);
  });

  it('skips a manual trigger when the same automation already has a running run', async () => {
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
    const skippedRun = {
      ...queuedRun,
      status: 'skipped' as const,
      finishedAt: Date.now(),
      error: 'previous_still_running',
    };
    vi.mocked(listQueuedRuns).mockResolvedValueOnce([
      { run: queuedRun, automation: baseAutomation },
    ]);
    vi.mocked(hasRunningRuns).mockResolvedValue(true);
    vi.mocked(updateRun).mockResolvedValue(skippedRun);

    await new AutomationScheduler().drainQueue();

    expect(hasRunningRuns).toHaveBeenCalledWith(baseAutomation.id);
    expect(updateRun).toHaveBeenCalledWith(queuedRun.id, {
      status: 'skipped',
      finishedAt: expect.any(Number),
      error: 'previous_still_running',
    });
    expect(claimQueuedRun).not.toHaveBeenCalled();
    expect(runQueuedAutomation).not.toHaveBeenCalled();
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

    expect(automationEvents._emit).toHaveBeenCalledWith('automation:run:start', runningRun);
    expect(automationEvents._emit).toHaveBeenCalledWith('automation:run:failed', failedRun);
    expect(events.emit).toHaveBeenCalledWith(
      automationRunUpdatedChannel,
      expect.objectContaining({
        automationId: failedRun.automationId,
        runId: failedRun.id,
        status: failedRun.status,
        taskId: failedRun.taskId,
      })
    );
  });

  it('logs queue drain failures without rejecting fire-and-forget drain callers', async () => {
    vi.mocked(listQueuedRuns).mockRejectedValueOnce(new Error('db failed'));

    await expect(new AutomationScheduler().drainQueue()).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalledWith('AutomationScheduler queue drain failed', {
      error: 'Error: db failed',
    });
  });

  it('schedules the next cron run after a worker completes a cron run', async () => {
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
      triggerKind: 'cron' as const,
      workerId: null,
    };
    const runningRun = {
      ...queuedRun,
      status: 'running' as const,
      startedAt: Date.now(),
      workerId: 'worker-1',
    };

    vi.mocked(listQueuedRuns)
      .mockResolvedValueOnce([{ run: queuedRun, automation: baseAutomation }])
      .mockResolvedValue([]);
    vi.mocked(claimQueuedRun).mockResolvedValue(runningRun);
    vi.mocked(runQueuedAutomation).mockResolvedValue({
      success: true,
      data: { ...runningRun, status: 'success' },
    });

    await new AutomationScheduler().drainQueue();
    await vi.waitFor(() => expect(ensureNextCronRun).toHaveBeenCalled());

    expect(ensureNextCronRun).toHaveBeenCalledWith(baseAutomation, expect.any(Number));
  });
});

describe('AutomationScheduler concurrency', () => {
  const successRun = {
    id: 'run-1',
    automationId: baseAutomation.id,
    scheduledAt: null,
    deadlineAt: null,
    startedAt: 1,
    finishedAt: 2,
    status: 'success' as const,
    taskId: null,
    createdTaskId: null,
    error: null,
    triggerKind: 'manual' as const,
    workerId: 'worker-1',
  };

  function makeQueuedEntry(runId: string) {
    const run = {
      id: runId,
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
    return { run, automation: baseAutomation };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hasRunningRuns).mockResolvedValue(false);
    vi.mocked(listQueuedRuns).mockResolvedValue([]);
    vi.mocked(claimQueuedRun).mockResolvedValue(null);
    vi.mocked(updateRun).mockResolvedValue(null);
    vi.mocked(ensureNextCronRun).mockResolvedValue(null);
  });

  it('runs at most four automation workers at a time', async () => {
    const entries = Array.from({ length: 6 }, (_, index) => makeQueuedEntry(`run-${index}`));
    const pending = [...entries];
    const releaseByRunId = new Map<string, () => void>();
    let inFlight = 0;
    let maxInFlight = 0;

    vi.mocked(listQueuedRuns).mockImplementation(async (limit = 100) => pending.splice(0, limit));
    vi.mocked(claimQueuedRun).mockImplementation(async (runId) => {
      const entry = entries.find((candidate) => candidate.run.id === runId);
      if (!entry) return null;
      return {
        ...entry.run,
        status: 'running' as const,
        startedAt: Date.now(),
        workerId: 'worker-1',
      };
    });
    vi.mocked(runQueuedAutomation).mockImplementation((_, run) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise((resolve) => {
        releaseByRunId.set(run.id, () => {
          inFlight -= 1;
          resolve({ success: true, data: { ...successRun, id: run.id } });
        });
      });
    });

    const scheduler = new AutomationScheduler();
    await scheduler.drainQueue();

    expect(runQueuedAutomation).toHaveBeenCalledTimes(4);
    expect(maxInFlight).toBe(4);

    releaseByRunId.get('run-0')?.();
    await vi.waitFor(() => expect(runQueuedAutomation).toHaveBeenCalledTimes(5));

    releaseByRunId.get('run-1')?.();
    await vi.waitFor(() => expect(runQueuedAutomation).toHaveBeenCalledTimes(6));

    for (const index of [2, 3, 4, 5]) {
      releaseByRunId.get(`run-${index}`)?.();
    }
    await vi.waitFor(() => expect(inFlight).toBe(0));

    expect(maxInFlight).toBe(4);
  });

  it('reruns a drain pass requested while another drain is active', async () => {
    const entry = makeQueuedEntry('run-rerun');
    const runningRun = {
      ...entry.run,
      status: 'running' as const,
      startedAt: Date.now(),
      workerId: 'worker-1',
    };
    let finishFirstList:
      | ((entries: Awaited<ReturnType<typeof listQueuedRuns>>) => void)
      | undefined;
    let releaseWorker: (() => void) | undefined;

    vi.mocked(listQueuedRuns)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirstList = resolve;
          })
      )
      .mockResolvedValueOnce([entry])
      .mockResolvedValue([]);
    vi.mocked(claimQueuedRun).mockResolvedValue(runningRun);
    vi.mocked(runQueuedAutomation).mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseWorker = () =>
            resolve({ success: true, data: { ...successRun, id: entry.run.id } });
        })
    );

    const scheduler = new AutomationScheduler();
    const firstDrain = scheduler.drainQueue();
    const secondDrain = scheduler.drainQueue();

    await vi.waitFor(() => expect(finishFirstList).toBeDefined());
    finishFirstList?.([]);
    await Promise.all([firstDrain, secondDrain]);

    expect(claimQueuedRun).toHaveBeenCalledWith(entry.run.id, expect.any(String));
    expect(runQueuedAutomation).toHaveBeenCalledOnce();

    releaseWorker?.();
    await vi.waitFor(() => expect(listQueuedRuns).toHaveBeenCalledTimes(4));
  });
});
