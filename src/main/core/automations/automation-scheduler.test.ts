import { beforeEach, describe, expect, it, vi } from 'vitest';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import type { Automation } from '@shared/automations/automation';
import type { AutomationRun } from '@shared/automations/automation-run';
import {
  automationRunUpdatedChannel,
  automationsChangedChannel,
} from '@shared/events/automationEvents';
import { AutomationScheduler } from './automation-scheduler';
import {
  enabledAutomationsWithoutQueuedRun,
  ensureNextCronRun,
  findRunsStuckInCreatingConversation,
  findRunsStuckInCreatingTask,
  findRunsStuckInLaunchingTask,
  listQueuedRuns,
  markDueCronRunsQueued,
  startCreatingTask,
  updateRun,
} from './repo';
import { runQueuedAutomation } from './runtime';

vi.mock('@main/lib/events', () => ({ events: { emit: vi.fn() } }));
vi.mock('@main/lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

vi.mock('./repo', () => ({
  enabledAutomationsWithoutQueuedRun: vi.fn(),
  ensureNextCronRun: vi.fn(),
  findRunsStuckInCreatingConversation: vi.fn(),
  findRunsStuckInCreatingTask: vi.fn(),
  findRunsStuckInLaunchingTask: vi.fn(),
  listQueuedRuns: vi.fn(),
  markDueCronRunsQueued: vi.fn(),
  startCreatingTask: vi.fn(),
  updateRun: vi.fn(),
}));

vi.mock('./runtime', () => ({
  runQueuedAutomation: vi.fn(),
}));

// Lazy import in scheduler requires automationsService mock
vi.mock('./automations-service', () => ({
  automationsService: { on: vi.fn() },
}));

const baseAutomation: Automation = {
  id: 'automation-1',
  name: 'Daily follow-up',
  triggerConfig: { expr: '0 9 * * *', tz: 'UTC' },
  conversationConfig: { prompt: 'Check things', provider: 'claude', autoApprove: false },
  projectId: 'project-1',
  enabled: true,
  createdAt: 0,
  updatedAt: 0,
};

function makeRun(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: 'run-1',
    automationId: baseAutomation.id,
    scheduledAt: Date.now(),
    deadlineAt: Date.now() + 60_000,
    startedAt: null,
    taskCreatedAt: null,
    launchedAt: null,
    finishedAt: null,
    status: 'queued',
    taskId: null,
    error: null,
    triggerKind: 'cron',
    triggerConfigSnapshot: { expr: '0 9 * * *', tz: 'UTC' },
    conversationConfigSnapshot: { prompt: 'Check things', provider: 'claude', autoApprove: false },
    taskConfigSnapshot: null,
    ...overrides,
  };
}

describe('AutomationScheduler bootstrap', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.mocked(findRunsStuckInCreatingTask).mockResolvedValue([]);
    vi.mocked(findRunsStuckInLaunchingTask).mockResolvedValue([]);
    vi.mocked(findRunsStuckInCreatingConversation).mockResolvedValue([]);
    vi.mocked(enabledAutomationsWithoutQueuedRun).mockResolvedValue([]);
    vi.mocked(markDueCronRunsQueued).mockResolvedValue([]);
    vi.mocked(listQueuedRuns).mockResolvedValue([]);
    vi.mocked(startCreatingTask).mockResolvedValue(null);
    vi.mocked(ensureNextCronRun).mockResolvedValue(null);
    vi.mocked(updateRun).mockResolvedValue(null);
    vi.mocked(runQueuedAutomation).mockResolvedValue({
      success: true,
      data: makeRun({ status: 'done', finishedAt: Date.now() }),
    });
  });

  it('calls ensureNextCronRun for each automation without a scheduled/queued run', async () => {
    vi.mocked(enabledAutomationsWithoutQueuedRun).mockResolvedValue([baseAutomation]);

    await new AutomationScheduler().reload();

    expect(ensureNextCronRun).toHaveBeenCalledWith(baseAutomation, expect.any(Number));
  });

  it('calls ensureNextCronRun for the next interval when a scheduled run becomes queued', async () => {
    const now = Date.UTC(2026, 4, 15, 12, 0, 0);
    const dueRun = makeRun({
      scheduledAt: Date.UTC(2026, 4, 15, 9, 0, 0),
      status: 'queued',
      triggerKind: 'cron',
    });
    vi.setSystemTime(now);
    vi.mocked(markDueCronRunsQueued).mockResolvedValue([
      { run: dueRun, automation: baseAutomation },
    ]);

    await new AutomationScheduler().reload();

    expect(ensureNextCronRun).toHaveBeenCalledWith(baseAutomation, now);
  });

  it('does not backfill multiple missed slots — only dispatches the one due run', async () => {
    const now = Date.UTC(2026, 4, 15, 12, 0, 0);
    const dueRun = makeRun({
      scheduledAt: Date.UTC(2026, 4, 15, 8, 0, 0),
      status: 'queued',
      triggerKind: 'cron',
    });
    vi.setSystemTime(now);
    vi.mocked(markDueCronRunsQueued).mockResolvedValue([
      { run: dueRun, automation: baseAutomation },
    ]);

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

  it('skips orphan automations without claiming a slot', async () => {
    const queuedRun = makeRun({
      status: 'queued',
      triggerKind: 'manual',
    });
    const skippedRun = makeRun({
      status: 'skipped',
      finishedAt: Date.now(),
      error: JSON.stringify({ step: 'queue', code: 'no_project' }),
    });
    vi.mocked(listQueuedRuns).mockResolvedValueOnce([
      { run: queuedRun, automation: { ...baseAutomation, projectId: undefined } },
    ]);
    vi.mocked(updateRun).mockResolvedValue(skippedRun);

    await new AutomationScheduler().drainQueue();

    expect(updateRun).toHaveBeenCalledWith(queuedRun.id, {
      status: 'skipped',
      finishedAt: expect.any(Number),
      error: JSON.stringify({ step: 'queue', code: 'no_project' }),
    });
    expect(startCreatingTask).not.toHaveBeenCalled();
    expect(runQueuedAutomation).not.toHaveBeenCalled();
    expect(events.emit).toHaveBeenCalledWith(
      automationRunUpdatedChannel,
      expect.objectContaining({
        automationId: skippedRun.automationId,
        runId: skippedRun.id,
        status: skippedRun.status,
      })
    );
    expect(events.emit).toHaveBeenCalledWith(automationsChangedChannel, undefined);
  });

  it('skips a run when the same automation is already in flight', async () => {
    const run1 = makeRun({ id: 'run-1', automationId: baseAutomation.id, status: 'queued' });
    const run2 = makeRun({ id: 'run-2', automationId: baseAutomation.id, status: 'queued' });
    const creatingTaskRun = makeRun({
      id: 'run-1',
      status: 'creating_task',
      startedAt: Date.now(),
    });
    const skippedRun = makeRun({
      id: 'run-2',
      status: 'skipped',
      finishedAt: Date.now(),
      error: JSON.stringify({ step: 'queue', code: 'previous_running' }),
    });

    vi.mocked(listQueuedRuns).mockResolvedValueOnce([
      { run: run1, automation: baseAutomation },
      { run: run2, automation: baseAutomation },
    ]);
    vi.mocked(startCreatingTask).mockResolvedValueOnce(creatingTaskRun).mockResolvedValue(null);
    vi.mocked(updateRun).mockResolvedValue(skippedRun);
    // Hold the worker so run1 stays in flight when run2 is evaluated
    vi.mocked(runQueuedAutomation).mockImplementation(() => new Promise(() => {}));

    await new AutomationScheduler().drainQueue();

    expect(startCreatingTask).toHaveBeenCalledWith(run1.id);
    expect(updateRun).toHaveBeenCalledWith(run2.id, {
      status: 'skipped',
      finishedAt: expect.any(Number),
      error: JSON.stringify({ step: 'queue', code: 'previous_running' }),
    });
  });

  it('marks a claimed run failed when the worker throws unexpectedly', async () => {
    const queuedRun = makeRun({ status: 'queued', triggerKind: 'manual' });
    const creatingTaskRun = makeRun({ status: 'creating_task', startedAt: Date.now() });
    const failedRun = makeRun({
      status: 'failed',
      finishedAt: Date.now(),
      error: JSON.stringify({ step: 'create_task', code: 'unknown', message: 'boom' }),
    });
    vi.mocked(listQueuedRuns).mockResolvedValueOnce([
      { run: queuedRun, automation: baseAutomation },
    ]);
    vi.mocked(startCreatingTask).mockResolvedValue(creatingTaskRun);
    vi.mocked(runQueuedAutomation).mockRejectedValue(new Error('boom'));
    vi.mocked(updateRun).mockResolvedValue(failedRun);

    await new AutomationScheduler().drainQueue();
    await vi.waitFor(() => {
      expect(updateRun).toHaveBeenCalledWith(creatingTaskRun.id, {
        status: 'failed',
        finishedAt: expect.any(Number),
        error: JSON.stringify({ step: 'create_task', code: 'unknown', message: 'boom' }),
      });
    });

    expect(events.emit).toHaveBeenCalledWith(
      automationRunUpdatedChannel,
      expect.objectContaining({
        automationId: failedRun.automationId,
        runId: failedRun.id,
        status: failedRun.status,
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
    const queuedRun = makeRun({ status: 'queued', triggerKind: 'cron' });
    const creatingTaskRun = makeRun({ status: 'creating_task', startedAt: Date.now() });

    vi.mocked(listQueuedRuns)
      .mockResolvedValueOnce([{ run: queuedRun, automation: baseAutomation }])
      .mockResolvedValue([]);
    vi.mocked(startCreatingTask).mockResolvedValue(creatingTaskRun);
    vi.mocked(runQueuedAutomation).mockResolvedValue({
      success: true,
      data: makeRun({ status: 'done', finishedAt: Date.now() }),
    });

    await new AutomationScheduler().drainQueue();
    await vi.waitFor(() => expect(ensureNextCronRun).toHaveBeenCalled());

    expect(ensureNextCronRun).toHaveBeenCalledWith(baseAutomation, expect.any(Number));
  });
});

describe('AutomationScheduler concurrency', () => {
  function makeQueuedEntry(runId: string) {
    const run = makeRun({ id: runId, automationId: `auto-${runId}`, status: 'queued' });
    const automation = { ...baseAutomation, id: `auto-${runId}` };
    return { run, automation };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listQueuedRuns).mockResolvedValue([]);
    vi.mocked(startCreatingTask).mockResolvedValue(null);
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
    vi.mocked(startCreatingTask).mockImplementation(async (runId) => {
      const entry = entries.find((candidate) => candidate.run.id === runId);
      if (!entry) return null;
      return makeRun({
        id: runId,
        automationId: entry.automation.id,
        status: 'creating_task',
        startedAt: Date.now(),
      });
    });
    vi.mocked(runQueuedAutomation).mockImplementation((_, run) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise((resolve) => {
        releaseByRunId.set(run.id, () => {
          inFlight -= 1;
          resolve({
            success: true,
            data: makeRun({ id: run.id, status: 'done', finishedAt: Date.now() }),
          });
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
    const creatingTaskRun = makeRun({
      id: entry.run.id,
      automationId: entry.automation.id,
      status: 'creating_task',
      startedAt: Date.now(),
    });
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
    vi.mocked(startCreatingTask).mockResolvedValue(creatingTaskRun);
    vi.mocked(runQueuedAutomation).mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseWorker = () =>
            resolve({
              success: true,
              data: makeRun({ id: entry.run.id, status: 'done', finishedAt: Date.now() }),
            });
        })
    );

    const scheduler = new AutomationScheduler();
    const firstDrain = scheduler.drainQueue();
    const secondDrain = scheduler.drainQueue();

    await vi.waitFor(() => expect(finishFirstList).toBeDefined());
    finishFirstList?.([]);
    await Promise.all([firstDrain, secondDrain]);

    expect(startCreatingTask).toHaveBeenCalledWith(entry.run.id);
    expect(runQueuedAutomation).toHaveBeenCalledOnce();

    releaseWorker?.();
    await vi.waitFor(() => expect(listQueuedRuns).toHaveBeenCalledTimes(4));
  });
});
