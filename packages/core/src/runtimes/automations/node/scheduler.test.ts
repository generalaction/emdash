import { ManualClock } from '@emdash/shared/testing';
import { LOCAL_HOST_REF } from '@primitives/host/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AutomationDeployment } from '../api/deployment';
import type { AutomationRun, AutomationRunId, AutomationRunStatus } from '../api/run';
import { AutomationRunTransitions } from './run-transitions';
import {
  AutomationScheduler,
  type AutomationSchedulerDeploymentStore,
  type AutomationSchedulerRunStore,
} from './scheduler';

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
      providerId: 'claude',
      prompt: 'Review open PRs',
      model: null,
      autoApprove: true,
    },
    repository: {
      host: LOCAL_HOST_REF,
      path: { root: { kind: 'posix' }, segments: ['repo'] },
    },
    git: {
      kind: 'create-branch',
      fromBranch: { type: 'local', branch: 'main' },
      pushBranch: false,
    },
    workspace: { kind: 'worktree' },
    updatedAt: START,
    ...overrides,
  };
}

class MemoryDeploymentStore implements AutomationSchedulerDeploymentStore {
  readonly deployments = new Map<string, AutomationDeployment>();

  constructor(deployments: AutomationDeployment[]) {
    for (const item of deployments) this.deployments.set(item.automationId, item);
  }

  getDeployment(id: string): AutomationDeployment | null {
    return this.deployments.get(id) ?? null;
  }

  listEnabledDeployments(): AutomationDeployment[] {
    return [...this.deployments.values()].filter((item) => item.enabled);
  }
}

class MemoryRunStore implements AutomationSchedulerRunStore {
  readonly runs = new Map<string, AutomationRun>();
  private seq = 1;

  insertRun(run: Omit<AutomationRun, 'seq'>): AutomationRun | null {
    if (
      run.status === 'scheduled' &&
      [...this.runs.values()].some(
        (existing) => existing.automationId === run.automationId && existing.status === 'scheduled'
      )
    ) {
      return null;
    }
    if (this.runs.has(run.id)) throw new Error(`duplicate run id: ${run.id}`);
    const stored = { ...run, seq: this.seq++ };
    this.runs.set(stored.id, stored);
    return stored;
  }

  getRun(id: AutomationRunId): AutomationRun | null {
    return this.runs.get(id) ?? null;
  }

  getScheduledRun(automationId: string): AutomationRun | null {
    return (
      [...this.runs.values()].find(
        (run) => run.automationId === automationId && run.status === 'scheduled'
      ) ?? null
    );
  }

  listDueScheduledRuns(now: number, limit: number): AutomationRun[] {
    return [...this.runs.values()]
      .filter(
        (run) => run.status === 'scheduled' && run.scheduledAt !== null && run.scheduledAt <= now
      )
      .sort((left, right) => (left.scheduledAt ?? 0) - (right.scheduledAt ?? 0))
      .slice(0, limit);
  }

  listQueuedRuns(limit: number): AutomationRun[] {
    return [...this.runs.values()]
      .filter((run) => run.status === 'queued')
      .sort((left, right) => left.seq - right.seq)
      .slice(0, limit);
  }

  listRunsInStatuses(statuses: AutomationRunStatus[]): AutomationRun[] {
    return [...this.runs.values()].filter((run) => statuses.includes(run.status));
  }

  transitionRun(
    id: AutomationRunId,
    from: AutomationRunStatus | AutomationRunStatus[],
    patch: Partial<AutomationRun>
  ): AutomationRun | null {
    const current = this.runs.get(id);
    const expected = Array.isArray(from) ? from : [from];
    if (!current || !expected.includes(current.status)) return null;
    const transitioned = { ...current, ...patch, seq: this.seq++ };
    this.runs.set(id, transitioned);
    return transitioned;
  }
}

function createHarness(options: {
  deployments?: AutomationDeployment[];
  execute?: (run: AutomationRun, signal: AbortSignal) => Promise<void>;
  maxConcurrentRuns?: number;
}) {
  const clock = new ManualClock(START);
  const deploymentStore = new MemoryDeploymentStore(options.deployments ?? [deployment()]);
  const runStore = new MemoryRunStore();
  const changed: AutomationRun[] = [];
  const transitions = new AutomationRunTransitions({
    runStore: runStore as never,
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

  return { changed, clock, deploymentStore, execute, runStore, scheduler };
}

const schedulers: AutomationScheduler[] = [];

afterEach(() => {
  for (const scheduler of schedulers.splice(0)) scheduler.stop();
});

describe('AutomationScheduler', () => {
  it('self-heals one future scheduled run for every enabled deployment', async () => {
    const harness = createHarness({
      deployments: [
        deployment(),
        deployment({ automationId: 'auto-2', enabled: false }),
        deployment({ automationId: 'auto-3' }),
      ],
    });
    schedulers.push(harness.scheduler);

    await harness.scheduler.start();
    await harness.scheduler.reload();

    const scheduled = [...harness.runStore.runs.values()].filter(
      (run) => run.status === 'scheduled'
    );
    expect(scheduled).toHaveLength(2);
    expect(scheduled.map((run) => run.automationId).sort()).toEqual(['auto-1', 'auto-3']);
    expect(scheduled.every((run) => run.scheduledAt === START + MINUTE)).toBe(true);
    expect(scheduled.every((run) => run.deadlineAt === START + 24 * 60 * MINUTE + MINUTE)).toBe(
      true
    );
    expect(harness.changed.filter((run) => run.status === 'scheduled')).toHaveLength(2);
  });

  it('queues and claims a due cron run, then schedules its next occurrence', async () => {
    const harness = createHarness({});
    schedulers.push(harness.scheduler);
    await harness.scheduler.start();

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
    const harness = createHarness({});
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
      worktree: null,
      branchName: null,
      conversationId: null,
      sessionId: null,
      error: null,
    });
    schedulers.push(harness.scheduler);

    await harness.scheduler.start();

    expect(harness.runStore.getRun('stuck-run')).toMatchObject({
      status: 'failed',
      finishedAt: START,
      error: { step: 'start_session', code: 'interrupted_by_restart' },
    });
  });

  it('starts a manual run immediately from a deployment snapshot', async () => {
    const harness = createHarness({});
    schedulers.push(harness.scheduler);

    const run = harness.scheduler.runNow(deployment());
    await harness.scheduler.idle();

    expect(run).toMatchObject({
      automationId: 'auto-1',
      status: 'queued',
      triggerKind: 'manual',
      scheduledAt: null,
      deadlineAt: null,
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
    const harness = createHarness({
      deployments: [
        deployment(),
        deployment({ automationId: 'auto-2' }),
        deployment({ automationId: 'auto-3' }),
      ],
      maxConcurrentRuns: 2,
      execute: () => new Promise<void>((resolve) => releases.push(resolve)),
    });
    schedulers.push(harness.scheduler);

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
    const harness = createHarness({
      maxConcurrentRuns: 2,
      execute: () => new Promise<void>((resolve) => (release = resolve)),
    });
    schedulers.push(harness.scheduler);

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
});
