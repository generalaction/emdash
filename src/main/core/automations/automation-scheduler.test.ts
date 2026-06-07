/**
 * Pure coordination tests for AutomationScheduler that do not need a real DB.
 * These cover the async-sequencing behavior of bootstrapTail and drainTail promise chains.
 *
 * DB-state tests (recovery, bootstrap self-healing, drain decisions, concurrency, events)
 * live in automation-scheduler.db.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { log } from '@main/lib/logger';
import type { Automation } from '@shared/core/automations/automation';
import { AutomationScheduler, type SchedulerCallbacks } from './automation-scheduler';
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

const noopCallbacks: SchedulerCallbacks = { onRunStep: () => {}, onScheduledRunChanged: () => {} };

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
  vi.mocked(runQueuedAutomation).mockResolvedValue({ success: true, data: {} as never });
});

describe('AutomationScheduler bootstrap serialization', () => {
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

    const scheduler = new AutomationScheduler(noopCallbacks);
    const firstReload = scheduler.reload();
    const secondReload = scheduler.reload();

    await vi.waitFor(() => expect(finishFirstBootstrap).toBeDefined());
    expect(enabledAutomationsWithoutQueuedRun).toHaveBeenCalledTimes(1);
    finishFirstBootstrap?.([]);
    await Promise.all([firstReload, secondReload]);

    expect(enabledAutomationsWithoutQueuedRun).toHaveBeenCalledTimes(2);
  });

  it('swallows bootstrap failures and does not reject reload callers', async () => {
    vi.mocked(enabledAutomationsWithoutQueuedRun).mockRejectedValueOnce(new Error('db failed'));

    await expect(new AutomationScheduler(noopCallbacks).reload()).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalledWith('AutomationScheduler bootstrap failed', {
      error: 'Error: db failed',
    });
  });
});

describe('AutomationScheduler drain serialization', () => {
  it('swallows queue drain failures and does not reject drain callers', async () => {
    vi.mocked(listQueuedRuns).mockRejectedValueOnce(new Error('db failed'));

    await expect(new AutomationScheduler(noopCallbacks).drainQueue()).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalledWith('AutomationScheduler queue drain failed', {
      error: 'Error: db failed',
    });
  });

  it('reruns a drain pass requested while another drain is active', async () => {
    let finishFirstList:
      | ((entries: Awaited<ReturnType<typeof listQueuedRuns>>) => void)
      | undefined;
    let releaseWorker: (() => void) | undefined;

    const automationId = 'auto-rerun';
    const runId = 'run-rerun';
    const entry = {
      run: {
        id: runId,
        automationId,
        scheduledAt: Date.now(),
        deadlineAt: Date.now() + 60_000,
        startedAt: null,
        taskCreatedAt: null,
        launchedAt: null,
        finishedAt: null,
        status: 'queued' as const,
        taskId: null,
        error: null,
        triggerKind: 'cron' as const,
        triggerConfigSnapshot: { expr: '0 9 * * *', tz: 'UTC' },
        conversationConfigSnapshot: {
          prompt: 'Check things',
          provider: 'claude',
          autoApprove: false,
        },
        taskConfigSnapshot: null,
        generatedTaskName: null,
      },
      automation: {
        id: automationId,
        name: 'Test',
        triggerConfig: { expr: '0 9 * * *', tz: 'UTC' },
        conversationConfig: { prompt: 'Check things', provider: 'claude', autoApprove: false },
        projectId: 'project-1',
        enabled: true,
        createdAt: 0,
        updatedAt: 0,
      },
    };
    const creatingTaskRun = {
      ...entry.run,
      status: 'creating_task' as const,
      startedAt: Date.now(),
    };

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
            resolve({ success: true, data: { ...creatingTaskRun, status: 'done' as const } });
        })
    );

    const scheduler = new AutomationScheduler(noopCallbacks);
    const firstDrain = scheduler.drainQueue();
    const secondDrain = scheduler.drainQueue();

    await vi.waitFor(() => expect(finishFirstList).toBeDefined());
    finishFirstList?.([]);
    await Promise.all([firstDrain, secondDrain]);

    expect(startCreatingTask).toHaveBeenCalledWith(runId);
    expect(runQueuedAutomation).toHaveBeenCalledOnce();

    releaseWorker?.();
    await vi.waitFor(() => expect(listQueuedRuns).toHaveBeenCalledTimes(4));
  });
});
