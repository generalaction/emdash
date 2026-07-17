import { ManualClock } from '@emdash/shared/testing';
import { LOCAL_HOST_REF } from '@primitives/host/api';
import type { TempStoreHandle } from '@primitives/sqlite-store/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AutomationDeployment } from '../../api/deployment';
import type { AutomationRun } from '../../api/run';
import { AutomationDeploymentStore } from '../persistence/deployment-store';
import { AutomationRunStore } from '../persistence/run-store';
import type { AutomationsDb } from '../persistence/store';
import { automationsStore } from '../persistence/store';
import { AutomationRunTransitions } from '../runs/transitions';
import { AutomationScheduler } from './scheduler';

const MINUTE = 60_000;
const START = Date.UTC(2026, 6, 16, 8, 59);

function deployment(overrides: Partial<AutomationDeployment> = {}): AutomationDeployment {
  return {
    automationId: 'auto-1',
    enabled: true,
    name: 'Nightly',
    schedule: { expr: '0 9 * * *', tz: 'UTC' },
    agent: {
      type: 'acp',
      start: {
        providerId: 'claude',
        model: null,
        initialQueue: [{ text: 'Review open PRs' }],
      },
    },
    workspace: {
      kind: 'worktree',
      repository: {
        host: LOCAL_HOST_REF,
        path: { root: { kind: 'posix' }, segments: ['repo'] },
      },
      preservePatterns: ['.env*'],
      git: {
        kind: 'create-branch',
        fromBranch: { type: 'local', branch: 'main' },
        pushRemote: null,
      },
    },
    revision: 1,
    ...overrides,
  };
}

async function createHarness(options: {
  deployments?: AutomationDeployment[];
  execute?: (run: AutomationRun, signal: AbortSignal) => Promise<void>;
  maxConcurrentRuns?: number;
}) {
  const handle = await automationsStore.openTemp();
  const clock = new ManualClock(START);
  const deploymentStore = new AutomationDeploymentStore(handle);
  for (const item of options.deployments ?? [deployment()]) {
    deploymentStore.upsertDeployment(item, START);
  }
  const runStore = new AutomationRunStore(handle);
  const changed: AutomationRun[] = [];
  const transitions = new AutomationRunTransitions({
    runStore,
    onRunChanged: (run) => changed.push(run),
  });
  let identity = 0;
  const execute = vi.fn(options.execute ?? (async () => {}));
  const scheduler = new AutomationScheduler({
    clock,
    deploymentStore,
    runStore,
    transitions,
    execute,
    maxConcurrentRuns: options.maxConcurrentRuns,
    onRunChanged: (run) => changed.push(run),
    createRunIdentity: () => {
      identity += 1;
      return { id: `run-${identity}`, generatedName: `automation-${identity}` };
    },
  });

  return { changed, clock, deploymentStore, execute, handle, runStore, scheduler };
}

const schedulers: AutomationScheduler[] = [];
const handles: TempStoreHandle<AutomationsDb>[] = [];

afterEach(async () => {
  for (const scheduler of schedulers.splice(0)) await scheduler.stop();
  for (const handle of handles.splice(0)) handle.close();
});

describe('AutomationScheduler', () => {
  it('self-heals one future scheduled run for every enabled deployment', async () => {
    const harness = await createHarness({
      deployments: [
        deployment(),
        deployment({ automationId: 'auto-2', enabled: false }),
        deployment({ automationId: 'auto-3' }),
      ],
    });
    schedulers.push(harness.scheduler);
    handles.push(harness.handle);

    harness.scheduler.start();
    harness.scheduler.reconcile();

    const scheduled = ['auto-1', 'auto-2', 'auto-3']
      .flatMap((automationId) =>
        harness.runStore.listChangedRuns({ sinceSeq: 0, automationId, limit: 100 })
      )
      .filter((run) => run.status === 'scheduled');
    expect(scheduled).toHaveLength(2);
    expect(scheduled.map((run) => run.automationId).sort()).toEqual(['auto-1', 'auto-3']);
    expect(scheduled.every((run) => run.scheduledAt === START + MINUTE)).toBe(true);
    expect(scheduled.every((run) => run.deadlineAt === START + 24 * 60 * MINUTE + MINUTE)).toBe(
      true
    );
    expect(harness.changed.filter((run) => run.status === 'scheduled')).toHaveLength(2);
  });

  it('queues and claims a due cron run, then schedules its next occurrence', async () => {
    const harness = await createHarness({});
    schedulers.push(harness.scheduler);
    handles.push(harness.handle);
    harness.scheduler.start();

    await harness.clock.advanceBy(MINUTE);
    await harness.scheduler.idle();

    expect(harness.execute).toHaveBeenCalledTimes(1);
    expect(harness.execute.mock.calls[0]?.[0]).toMatchObject({
      automationId: 'auto-1',
      status: 'provisioning_workspace',
      triggerKind: 'cron',
      startedAt: START + MINUTE,
    });
    expect(harness.runStore.getScheduledRun('auto-1')).toMatchObject({
      scheduledAt: START + 24 * 60 * MINUTE + MINUTE,
    });
  });

  it('marks in-flight runs failed during startup recovery', async () => {
    const harness = await createHarness({});
    harness.runStore.insertRun({
      id: 'stuck-run',
      automationId: 'auto-1',
      status: 'starting_session',
      triggerKind: 'manual',
      configSnapshot: deployment(),
      generatedName: 'stuck',
      scheduledAt: null,
      deadlineAt: null,
      startedAt: START - MINUTE,
      finishedAt: null,
      workspace: {
        host: LOCAL_HOST_REF,
        path: { root: { kind: 'posix' }, segments: ['worktrees', 'stuck'] },
      },
      branchName: 'stuck',
      conversationId: null,
      sessionId: null,
      error: null,
    });
    schedulers.push(harness.scheduler);
    handles.push(harness.handle);

    harness.scheduler.start();

    expect(harness.runStore.getRun('stuck-run')).toMatchObject({
      status: 'failed',
      finishedAt: START,
      error: { step: 'start_session', code: 'interrupted_by_restart' },
    });
  });

  it('starts a manual run immediately from a deployment snapshot', async () => {
    const harness = await createHarness({});
    schedulers.push(harness.scheduler);
    handles.push(harness.handle);

    const run = harness.scheduler.runNow(deployment());
    await harness.scheduler.idle();

    // Draining is synchronous, so the returned run is already claimed.
    expect(run).toMatchObject({
      automationId: 'auto-1',
      status: 'provisioning_workspace',
      triggerKind: 'manual',
      scheduledAt: null,
      deadlineAt: null,
      startedAt: START,
    });
    expect(harness.execute).toHaveBeenCalledTimes(1);
    expect(harness.execute.mock.calls[0]?.[0]).toMatchObject({
      id: run.id,
      status: 'provisioning_workspace',
      startedAt: START,
    });
  });

  it('bounds concurrent workers', async () => {
    const releases: Array<() => void> = [];
    const harness = await createHarness({
      deployments: [
        deployment(),
        deployment({ automationId: 'auto-2' }),
        deployment({ automationId: 'auto-3' }),
      ],
      maxConcurrentRuns: 2,
      execute: () => new Promise<void>((resolve) => releases.push(resolve)),
    });
    schedulers.push(harness.scheduler);
    handles.push(harness.handle);
    harness.scheduler.start();

    harness.scheduler.runNow(deployment());
    harness.scheduler.runNow(deployment({ automationId: 'auto-2' }));
    harness.scheduler.runNow(deployment({ automationId: 'auto-3' }));
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.execute).toHaveBeenCalledTimes(2);

    releases.shift()?.();
    releases.shift()?.();
    await vi.waitFor(() => {
      expect(harness.execute).toHaveBeenCalledTimes(3);
    });
    releases.shift()?.();
    await harness.scheduler.idle();

    expect(harness.execute).toHaveBeenCalledTimes(3);
  });

  it('skips a queued run while the same automation is already executing', async () => {
    let release: (() => void) | undefined;
    const harness = await createHarness({
      maxConcurrentRuns: 2,
      execute: () => new Promise<void>((resolve) => (release = resolve)),
    });
    schedulers.push(harness.scheduler);
    handles.push(harness.handle);

    harness.scheduler.runNow(deployment());
    await vi.waitFor(() => {
      expect(harness.execute).toHaveBeenCalledTimes(1);
    });
    const overlapping = harness.scheduler.runNow(deployment());
    await vi.waitFor(() => {
      expect(harness.runStore.getRun(overlapping.id)?.status).toBe('skipped');
    });

    expect(harness.runStore.getRun(overlapping.id)?.error).toMatchObject({
      step: 'queue',
      code: 'previous_running',
    });
    release?.();
    await harness.scheduler.idle();
  });

  it('stop aborts in-flight workers and awaits them', async () => {
    const aborts: string[] = [];
    const harness = await createHarness({
      execute: (run, signal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => {
            aborts.push(run.id);
            resolve();
          });
        }),
    });
    schedulers.push(harness.scheduler);
    handles.push(harness.handle);
    harness.scheduler.start();

    const run = harness.scheduler.runNow(deployment());
    await vi.waitFor(() => {
      expect(harness.execute).toHaveBeenCalledTimes(1);
    });

    await harness.scheduler.stop();

    expect(aborts).toEqual([run.id]);
  });

  it('does not start queued work after stop', async () => {
    let release: (() => void) | undefined;
    const harness = await createHarness({
      deployments: [deployment(), deployment({ automationId: 'auto-2' })],
      maxConcurrentRuns: 1,
      execute: (_run, signal) =>
        new Promise<void>((resolve) => {
          release = resolve;
          signal.addEventListener('abort', () => resolve());
        }),
    });
    schedulers.push(harness.scheduler);
    handles.push(harness.handle);
    harness.scheduler.start();

    harness.scheduler.runNow(deployment());
    await vi.waitFor(() => {
      expect(harness.execute).toHaveBeenCalledTimes(1);
    });
    const waiting = harness.scheduler.runNow(deployment({ automationId: 'auto-2' }));
    expect(waiting.status).toBe('queued');

    await harness.scheduler.stop();
    release?.();
    await harness.scheduler.idle();

    expect(harness.execute).toHaveBeenCalledTimes(1);
    expect(harness.runStore.getRun(waiting.id)?.status).toBe('queued');
  });

  it('replaces a scheduled run when the deployment schedule changes', async () => {
    const harness = await createHarness({});
    schedulers.push(harness.scheduler);
    handles.push(harness.handle);
    harness.scheduler.start();

    const original = harness.runStore.getScheduledRun('auto-1');
    expect(original).not.toBeNull();
    if (!original) return;

    harness.deploymentStore.upsertDeployment(
      deployment({ revision: 2, schedule: { expr: '30 9 * * *', tz: 'UTC' } }),
      START
    );
    harness.scheduler.reconcile();

    expect(harness.runStore.getRun(original.id)).toMatchObject({
      status: 'skipped',
      error: { step: 'queue', code: 'redeployed' },
    });
    const replacement = harness.runStore.getScheduledRun('auto-1');
    expect(replacement?.id).not.toBe(original.id);
    expect(replacement?.scheduledAt).toBe(START + 31 * MINUTE);
  });

  it('cancelRun returns null only for unknown runs and is idempotent for terminal runs', async () => {
    const harness = await createHarness({});
    schedulers.push(harness.scheduler);
    handles.push(harness.handle);

    expect(harness.scheduler.cancelRun('missing')).toBeNull();

    const run = harness.scheduler.runNow(deployment());
    await harness.scheduler.idle();

    const cancelled = harness.scheduler.cancelRun(run.id);
    expect(cancelled).toMatchObject({ id: run.id, status: 'cancelled' });

    const repeat = harness.scheduler.cancelRun(run.id);
    expect(repeat).toMatchObject({ id: run.id, status: 'cancelled' });
  });
});
