import { openFixture } from '@tooling/utils/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppDb } from '@main/db/client';
import { ok } from '@shared/result';
import { AutomationScheduler, type SchedulerCallbacks } from './automation-scheduler';
import { insertRun } from './repo';
import { markRunDone } from './run-transitions';
import type { AutomationRunExecutor } from './runtime';

// Stop client.ts from opening the real Electron DB at import time.
// All domain code (repo, run-transitions) will read this getter and get the fixture DB.
const mocks = vi.hoisted(() => ({ db: undefined as AppDb | undefined }));
vi.mock('@main/db/client', () => ({
  get db() {
    if (!mocks.db) throw new Error('Test database not initialized');
    return mocks.db;
  },
}));


// ---------------------------------------------------------------------------
// Seeding helpers
// ---------------------------------------------------------------------------

const TRIGGER_CONFIG = JSON.stringify({ expr: '0 9 * * *', tz: 'UTC' });
const CONVERSATION_CONFIG = JSON.stringify({
  prompt: 'Check things',
  provider: 'claude',
  autoApprove: false,
});

function seedProject(fixture: Awaited<ReturnType<typeof openFixture>>, id = 'project-1'): void {
  fixture.sqlite
    .prepare(
      `INSERT INTO projects (id, name, path, created_at, updated_at)
       VALUES (?, 'Test Project', '/repo', 0, 0)`
    )
    .run(id);
}

function seedAutomation(
  fixture: Awaited<ReturnType<typeof openFixture>>,
  opts: {
    id?: string;
    projectId?: string | null;
    enabled?: number;
    triggerConfig?: string;
  } = {}
): string {
  const id = opts.id ?? 'automation-1';
  const projectId = opts.projectId === undefined ? 'project-1' : opts.projectId;
  const enabled = opts.enabled ?? 1;
  const triggerConfig = opts.triggerConfig ?? TRIGGER_CONFIG;

  fixture.sqlite
    .prepare(
      `INSERT INTO automations (id, name, project_id, trigger_config, conversation_config, enabled, created_at, updated_at)
       VALUES (?, 'Daily follow-up', ?, ?, ?, ?, 0, 0)`
    )
    .run(id, projectId, triggerConfig, CONVERSATION_CONFIG, enabled);

  return id;
}

function getRunRow(
  fixture: Awaited<ReturnType<typeof openFixture>>,
  id: string
): { status: string; error: string | null; task_id: string | null } | undefined {
  return fixture.sqlite
    .prepare('SELECT status, error, task_id FROM automation_runs WHERE id = ?')
    .get(id) as { status: string; error: string | null; task_id: string | null } | undefined;
}

function countRunsByStatus(
  fixture: Awaited<ReturnType<typeof openFixture>>,
  status: string,
  automationId?: string
): number {
  if (automationId) {
    return (
      fixture.sqlite
        .prepare('SELECT COUNT(*) as n FROM automation_runs WHERE status = ? AND automation_id = ?')
        .get(status, automationId) as { n: number }
    ).n;
  }
  return (
    fixture.sqlite
      .prepare('SELECT COUNT(*) as n FROM automation_runs WHERE status = ?')
      .get(status) as { n: number }
  ).n;
}

// ---------------------------------------------------------------------------
// Fake executor helpers
// ---------------------------------------------------------------------------

/** Executor that immediately marks the run done and notifies onStepCompleted. */
const doneExecutor: AutomationRunExecutor = async (_automation, run, onStepCompleted) => {
  const done = await markRunDone(run.id, Date.now());
  onStepCompleted(done);
  return ok(done);
};

/** Executor that holds until the returned release() is called, then marks done. */
function makeHeldExecutor(): { executor: AutomationRunExecutor; release: () => void } {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const executor: AutomationRunExecutor = async (_automation, run, onStepCompleted) => {
    await gate;
    const done = await markRunDone(run.id, Date.now());
    onStepCompleted(done);
    return ok(done);
  };
  return { executor, release };
}

/** Executor that always throws. */
const throwingExecutor: AutomationRunExecutor = async () => {
  throw new Error('boom');
};

function makeCallbacks(onRunStep?: SchedulerCallbacks['onRunStep']): SchedulerCallbacks {
  return { onRunStep: onRunStep ?? (() => {}), onScheduledRunChanged: () => {} };
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let fixture: Awaited<ReturnType<typeof openFixture>>;

beforeEach(async () => {
  vi.useFakeTimers();
  fixture = await openFixture('empty');
  mocks.db = fixture.db;
});

afterEach(() => {
  fixture.close();
  mocks.db = undefined;
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Recovery on startup
// ---------------------------------------------------------------------------

describe('AutomationScheduler recovery', () => {
  it('marks creating_task (no taskId) runs as failed with interrupted_by_restart', async () => {
    seedProject(fixture);
    const automationId = seedAutomation(fixture);
    const run = await insertRun({
      automationId,
      triggerConfigSnapshot: { expr: '0 9 * * *', tz: 'UTC' },
      conversationConfigSnapshot: {
        prompt: 'Check things',
        provider: 'claude',
        autoApprove: false,
      },
      status: 'creating_task',
      triggerKind: 'cron',
      startedAt: Date.now(),
    });

    const scheduler = new AutomationScheduler(makeCallbacks(), doneExecutor);
    scheduler.start();
    await vi.waitFor(() => {
      const row = getRunRow(fixture, run.id);
      expect(row?.status).toBe('failed');
    });
    scheduler.stop();

    const row = getRunRow(fixture, run.id);
    expect(row?.status).toBe('failed');
    expect(row?.error).toContain('interrupted_by_restart');
  });

  it('marks launching_task runs as failed with interrupted_by_restart', async () => {
    seedProject(fixture);
    const automationId = seedAutomation(fixture);
    const run = await insertRun({
      automationId,
      triggerConfigSnapshot: { expr: '0 9 * * *', tz: 'UTC' },
      conversationConfigSnapshot: {
        prompt: 'Check things',
        provider: 'claude',
        autoApprove: false,
      },
      status: 'launching_task',
      triggerKind: 'cron',
      startedAt: Date.now(),
      taskId: 'task-placeholder',
    });

    const scheduler = new AutomationScheduler(makeCallbacks(), doneExecutor);
    scheduler.start();
    await vi.waitFor(() => expect(getRunRow(fixture, run.id)?.status).toBe('failed'));
    scheduler.stop();

    expect(getRunRow(fixture, run.id)?.error).toContain('interrupted_by_restart');
  });

  it('marks creating_conversation runs as failed with interrupted_by_restart', async () => {
    seedProject(fixture);
    const automationId = seedAutomation(fixture);
    const run = await insertRun({
      automationId,
      triggerConfigSnapshot: { expr: '0 9 * * *', tz: 'UTC' },
      conversationConfigSnapshot: {
        prompt: 'Check things',
        provider: 'claude',
        autoApprove: false,
      },
      status: 'creating_conversation',
      triggerKind: 'cron',
      startedAt: Date.now(),
      taskId: 'task-placeholder',
    });

    const scheduler = new AutomationScheduler(makeCallbacks(), doneExecutor);
    scheduler.start();
    await vi.waitFor(() => expect(getRunRow(fixture, run.id)?.status).toBe('failed'));
    scheduler.stop();

    expect(getRunRow(fixture, run.id)?.error).toContain('interrupted_by_restart');
  });

  it('leaves healthy queued runs untouched during recovery', async () => {
    seedProject(fixture);
    const automationId = seedAutomation(fixture);

    // Seed a queued run that should not be touched by recovery
    const run = await insertRun({
      automationId,
      triggerConfigSnapshot: { expr: '0 9 * * *', tz: 'UTC' },
      conversationConfigSnapshot: {
        prompt: 'Check things',
        provider: 'claude',
        autoApprove: false,
      },
      status: 'queued',
      triggerKind: 'cron',
    });

    // Use a held executor so the drain doesn't immediately consume it — we only care about recovery
    const { executor, release } = makeHeldExecutor();
    const scheduler = new AutomationScheduler(makeCallbacks(), executor);
    scheduler.start();

    // Give recovery time to run (it runs immediately on start())
    await vi.waitFor(() => {
      // Bootstrap should have run (it's a separate promise chain from recovery)
      // We just need to verify the run was not touched by recovery
      const row = getRunRow(fixture, run.id);
      // Status should be queued or creating_task (drain may have claimed it), never failed
      expect(row?.status).not.toBe('failed');
    });

    release();
    scheduler.stop();
  });
});

// ---------------------------------------------------------------------------
// Bootstrap self-healing
// ---------------------------------------------------------------------------

describe('AutomationScheduler bootstrap self-healing', () => {
  it('schedules a cron run for an enabled automation that has none', async () => {
    const now = Date.UTC(2026, 4, 15, 12, 0, 0); // 2026-05-15 12:00 UTC
    vi.setSystemTime(now);

    seedProject(fixture);
    seedAutomation(fixture); // enabled, no runs yet

    const scheduler = new AutomationScheduler(makeCallbacks(), doneExecutor);
    await scheduler.reload();

    expect(countRunsByStatus(fixture, 'scheduled', 'automation-1')).toBe(1);
  });

  it('does not create a duplicate when a scheduled run already exists', async () => {
    const now = Date.UTC(2026, 4, 15, 12, 0, 0);
    vi.setSystemTime(now);

    seedProject(fixture);
    const automationId = seedAutomation(fixture);

    // Pre-seed an existing scheduled run
    await insertRun({
      automationId,
      triggerConfigSnapshot: { expr: '0 9 * * *', tz: 'UTC' },
      conversationConfigSnapshot: {
        prompt: 'Check things',
        provider: 'claude',
        autoApprove: false,
      },
      scheduledAt: Date.UTC(2026, 4, 16, 9, 0, 0),
      deadlineAt: Date.UTC(2026, 4, 17, 9, 0, 0),
      status: 'scheduled',
      triggerKind: 'cron',
    });

    const scheduler = new AutomationScheduler(makeCallbacks(), doneExecutor);
    await scheduler.reload();

    expect(countRunsByStatus(fixture, 'scheduled', automationId)).toBe(1);
  });

  it('is idempotent — calling reload() twice creates no duplicates', async () => {
    const now = Date.UTC(2026, 4, 15, 12, 0, 0);
    vi.setSystemTime(now);

    seedProject(fixture);
    seedAutomation(fixture);

    const scheduler = new AutomationScheduler(makeCallbacks(), doneExecutor);
    await scheduler.reload();
    await scheduler.reload();

    expect(countRunsByStatus(fixture, 'scheduled', 'automation-1')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Due cron transition
// ---------------------------------------------------------------------------

describe('AutomationScheduler due cron transition', () => {
  it('transitions a past-due scheduled run to queued and pre-schedules the next occurrence', async () => {
    const now = Date.UTC(2026, 4, 15, 12, 0, 0);
    vi.setSystemTime(now);

    seedProject(fixture);
    const automationId = seedAutomation(fixture);

    // Scheduled run that is already past due
    await insertRun({
      automationId,
      triggerConfigSnapshot: { expr: '0 9 * * *', tz: 'UTC' },
      conversationConfigSnapshot: {
        prompt: 'Check things',
        provider: 'claude',
        autoApprove: false,
      },
      scheduledAt: Date.UTC(2026, 4, 15, 9, 0, 0), // 9 AM, before our "now" of 12 PM
      deadlineAt: Date.UTC(2026, 4, 16, 9, 0, 0),
      status: 'scheduled',
      triggerKind: 'cron',
    });

    const { executor, release } = makeHeldExecutor();
    const scheduler = new AutomationScheduler(makeCallbacks(), executor);
    await scheduler.reload();
    release();

    // The due run should have become queued (or been drained to creating_task)
    const rows = fixture.sqlite
      .prepare('SELECT status FROM automation_runs WHERE automation_id = ? AND scheduled_at = ?')
      .all(automationId, Date.UTC(2026, 4, 15, 9, 0, 0)) as { status: string }[];
    expect(['queued', 'creating_task', 'done']).toContain(rows[0]?.status);

    // A next occurrence should have been pre-scheduled
    const nextRows = fixture.sqlite
      .prepare(
        "SELECT status FROM automation_runs WHERE automation_id = ? AND scheduled_at > ? AND status = 'scheduled'"
      )
      .all(automationId, Date.UTC(2026, 4, 15, 9, 0, 0)) as { status: string }[];
    expect(nextRows.length).toBeGreaterThanOrEqual(1);
  });

  it('leaves a future-dated scheduled run in scheduled state', async () => {
    const now = Date.UTC(2026, 4, 15, 8, 0, 0); // before 9 AM
    vi.setSystemTime(now);

    seedProject(fixture);
    const automationId = seedAutomation(fixture);

    await insertRun({
      automationId,
      triggerConfigSnapshot: { expr: '0 9 * * *', tz: 'UTC' },
      conversationConfigSnapshot: {
        prompt: 'Check things',
        provider: 'claude',
        autoApprove: false,
      },
      scheduledAt: Date.UTC(2026, 4, 15, 9, 0, 0), // 9 AM — still in the future
      deadlineAt: Date.UTC(2026, 4, 16, 9, 0, 0),
      status: 'scheduled',
      triggerKind: 'cron',
    });

    const scheduler = new AutomationScheduler(makeCallbacks(), doneExecutor);
    await scheduler.reload();

    expect(countRunsByStatus(fixture, 'scheduled', automationId)).toBe(1);
    expect(countRunsByStatus(fixture, 'queued', automationId)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Drain queue decisions
// ---------------------------------------------------------------------------

describe('AutomationScheduler drain queue decisions', () => {
  it('skips a run whose deadline has already passed', async () => {
    const now = Date.UTC(2026, 4, 15, 12, 0, 0);
    vi.setSystemTime(now);

    seedProject(fixture);
    const automationId = seedAutomation(fixture);

    const run = await insertRun({
      automationId,
      triggerConfigSnapshot: { expr: '0 9 * * *', tz: 'UTC' },
      conversationConfigSnapshot: {
        prompt: 'Check things',
        provider: 'claude',
        autoApprove: false,
      },
      scheduledAt: Date.UTC(2026, 4, 15, 9, 0, 0),
      deadlineAt: Date.UTC(2026, 4, 15, 10, 0, 0), // already past
      status: 'queued',
      triggerKind: 'cron',
    });

    let executorCalled = false;
    const scheduler = new AutomationScheduler(makeCallbacks(), async (_a, r, onStep) => {
      executorCalled = true;
      const done = await markRunDone(r.id, Date.now());
      onStep(done);
      return ok(done);
    });
    await scheduler.drainQueue();

    expect(executorCalled).toBe(false);
    const row = getRunRow(fixture, run.id);
    expect(row?.status).toBe('skipped');
    expect(row?.error).toContain('deadline_exceeded');
  });

  it('skips a run for an automation with no project', async () => {
    seedProject(fixture);
    seedAutomation(fixture, { id: 'automation-orphan', projectId: null });

    const run = await insertRun({
      automationId: 'automation-orphan',
      triggerConfigSnapshot: { expr: '0 9 * * *', tz: 'UTC' },
      conversationConfigSnapshot: {
        prompt: 'Check things',
        provider: 'claude',
        autoApprove: false,
      },
      status: 'queued',
      triggerKind: 'manual',
    });

    let executorCalled = false;
    const scheduler = new AutomationScheduler(makeCallbacks(), async (_a, r, onStep) => {
      executorCalled = true;
      const done = await markRunDone(r.id, Date.now());
      onStep(done);
      return ok(done);
    });
    await scheduler.drainQueue();

    expect(executorCalled).toBe(false);
    const row = getRunRow(fixture, run.id);
    expect(row?.status).toBe('skipped');
    expect(row?.error).toContain('no_project');
  });

  it('skips the second run when the same automation is already in flight', async () => {
    seedProject(fixture);
    const automationId = seedAutomation(fixture);

    const run1 = await insertRun({
      automationId,
      triggerConfigSnapshot: { expr: '0 9 * * *', tz: 'UTC' },
      conversationConfigSnapshot: {
        prompt: 'Check things',
        provider: 'claude',
        autoApprove: false,
      },
      status: 'queued',
      triggerKind: 'cron',
      scheduledAt: Date.UTC(2026, 4, 15, 9, 0, 0),
    });
    const run2 = await insertRun({
      automationId,
      triggerConfigSnapshot: { expr: '0 9 * * *', tz: 'UTC' },
      conversationConfigSnapshot: {
        prompt: 'Check things',
        provider: 'claude',
        autoApprove: false,
      },
      status: 'queued',
      triggerKind: 'cron',
      scheduledAt: Date.UTC(2026, 4, 15, 10, 0, 0),
    });

    const { executor, release } = makeHeldExecutor();
    const scheduler = new AutomationScheduler(makeCallbacks(), executor);
    await scheduler.drainQueue();

    // First run should be in flight (creating_task)
    expect(getRunRow(fixture, run1.id)?.status).toBe('creating_task');
    // Second run for the same automation should be skipped
    expect(getRunRow(fixture, run2.id)?.status).toBe('skipped');
    expect(getRunRow(fixture, run2.id)?.error).toContain('previous_running');

    release();
    await vi.waitFor(() => expect(getRunRow(fixture, run1.id)?.status).toBe('done'));
  });

  it('does not re-claim a run that is already past queued (CAS guard)', async () => {
    seedProject(fixture);
    const automationId = seedAutomation(fixture);

    // Seed a run already in creating_task — the CAS in startCreatingTask should skip it
    const run = await insertRun({
      automationId,
      triggerConfigSnapshot: { expr: '0 9 * * *', tz: 'UTC' },
      conversationConfigSnapshot: {
        prompt: 'Check things',
        provider: 'claude',
        autoApprove: false,
      },
      status: 'creating_task',
      triggerKind: 'cron',
      startedAt: Date.now(),
    });

    let executorCalled = false;
    const scheduler = new AutomationScheduler(makeCallbacks(), async (_a, r, onStep) => {
      executorCalled = true;
      const done = await markRunDone(r.id, Date.now());
      onStep(done);
      return ok(done);
    });
    await scheduler.drainQueue();

    expect(executorCalled).toBe(false);
    // Status should remain creating_task (was not touched by drain)
    expect(getRunRow(fixture, run.id)?.status).toBe('creating_task');
  });
});

// ---------------------------------------------------------------------------
// Concurrency (slot pool) on real DB
// ---------------------------------------------------------------------------

describe('AutomationScheduler concurrency', () => {
  it('runs at most 4 automation workers concurrently', async () => {
    seedProject(fixture);

    const releaseMap = new Map<string, () => void>();
    const executorCalls: string[] = [];

    for (let i = 0; i < 6; i++) {
      const autoId = `auto-${i}`;
      seedAutomation(fixture, { id: autoId });
      await insertRun({
        automationId: autoId,
        triggerConfigSnapshot: { expr: '0 9 * * *', tz: 'UTC' },
        conversationConfigSnapshot: {
          prompt: 'Check things',
          provider: 'claude',
          autoApprove: false,
        },
        status: 'queued',
        triggerKind: 'cron',
        scheduledAt: Date.UTC(2026, 4, 15, 9, i, 0),
      });
    }

    const executor: AutomationRunExecutor = async (_automation, run, onStepCompleted) => {
      executorCalls.push(run.id);
      const gate = new Promise<void>((resolve) => releaseMap.set(run.id, resolve));
      await gate;
      const done = await markRunDone(run.id, Date.now());
      onStepCompleted(done);
      return ok(done);
    };

    const scheduler = new AutomationScheduler(makeCallbacks(), executor);
    await scheduler.drainQueue();

    // Only 4 should be in creating_task (slot cap)
    expect(countRunsByStatus(fixture, 'creating_task')).toBe(4);
    expect(countRunsByStatus(fixture, 'queued')).toBe(2);
    expect(executorCalls).toHaveLength(4);

    // Release one slot — a 5th should start
    releaseMap.get(executorCalls[0]!)?.();
    await vi.waitFor(() => expect(executorCalls).toHaveLength(5));
    expect(countRunsByStatus(fixture, 'creating_task')).toBe(4);

    // Release all remaining
    for (const runId of executorCalls.slice(1)) {
      releaseMap.get(runId)?.();
    }
    await vi.waitFor(() => expect(countRunsByStatus(fixture, 'done')).toBe(6));
  });
});

// ---------------------------------------------------------------------------
// Post-worker rescheduling
// ---------------------------------------------------------------------------

describe('AutomationScheduler post-worker rescheduling', () => {
  it('schedules the next cron occurrence after a cron worker completes', async () => {
    const now = Date.UTC(2026, 4, 15, 9, 0, 0);
    vi.setSystemTime(now);

    seedProject(fixture);
    const automationId = seedAutomation(fixture);

    const run = await insertRun({
      automationId,
      triggerConfigSnapshot: { expr: '0 9 * * *', tz: 'UTC' },
      conversationConfigSnapshot: {
        prompt: 'Check things',
        provider: 'claude',
        autoApprove: false,
      },
      status: 'queued',
      triggerKind: 'cron',
      scheduledAt: now,
    });

    const scheduler = new AutomationScheduler(makeCallbacks(), doneExecutor);
    await scheduler.drainQueue();

    await vi.waitFor(() => expect(getRunRow(fixture, run.id)?.status).toBe('done'));

    // A subsequent scheduled run should now exist
    const nextRows = fixture.sqlite
      .prepare(
        "SELECT status FROM automation_runs WHERE automation_id = ? AND id != ? AND status = 'scheduled'"
      )
      .all(automationId, run.id) as { status: string }[];
    expect(nextRows.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Step callback notifications
// ---------------------------------------------------------------------------

describe('AutomationScheduler step notifications', () => {
  it('calls stepSpy when a run is skipped due to no_project', async () => {
    seedProject(fixture);
    seedAutomation(fixture, { id: 'automation-orphan', projectId: null });

    await insertRun({
      automationId: 'automation-orphan',
      triggerConfigSnapshot: { expr: '0 9 * * *', tz: 'UTC' },
      conversationConfigSnapshot: {
        prompt: 'Check things',
        provider: 'claude',
        autoApprove: false,
      },
      status: 'queued',
      triggerKind: 'manual',
    });

    const stepSpy = vi.fn();
    const scheduler = new AutomationScheduler(makeCallbacks(stepSpy), doneExecutor);
    await scheduler.drainQueue();

    expect(stepSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'skipped', automationId: 'automation-orphan' })
    );
  });

  it('calls stepSpy with the correct automationId and status for a failed recovery', async () => {
    seedProject(fixture);
    const automationId = seedAutomation(fixture);

    const run = await insertRun({
      automationId,
      triggerConfigSnapshot: { expr: '0 9 * * *', tz: 'UTC' },
      conversationConfigSnapshot: {
        prompt: 'Check things',
        provider: 'claude',
        autoApprove: false,
      },
      status: 'creating_task',
      triggerKind: 'cron',
      startedAt: Date.now(),
    });

    const stepSpy = vi.fn();
    const scheduler = new AutomationScheduler(makeCallbacks(stepSpy), doneExecutor);
    scheduler.start();
    await vi.waitFor(() =>
      expect(stepSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: run.id, status: 'failed', automationId })
      )
    );
    scheduler.stop();
  });

  it('calls stepSpy with done status after a successful worker execution', async () => {
    const now = Date.UTC(2026, 4, 15, 9, 0, 0);
    vi.setSystemTime(now);

    seedProject(fixture);
    const automationId = seedAutomation(fixture);

    const run = await insertRun({
      automationId,
      triggerConfigSnapshot: { expr: '0 9 * * *', tz: 'UTC' },
      conversationConfigSnapshot: {
        prompt: 'Check things',
        provider: 'claude',
        autoApprove: false,
      },
      status: 'queued',
      triggerKind: 'manual',
      scheduledAt: now,
    });

    const stepSpy = vi.fn();
    const scheduler = new AutomationScheduler(makeCallbacks(stepSpy), doneExecutor);
    await scheduler.drainQueue();

    await vi.waitFor(() =>
      expect(stepSpy).toHaveBeenCalledWith(expect.objectContaining({ id: run.id, status: 'done' }))
    );
  });

  it('calls stepSpy when transitioning run to creating_task during drain', async () => {
    seedProject(fixture);
    const automationId = seedAutomation(fixture);

    const run = await insertRun({
      automationId,
      triggerConfigSnapshot: { expr: '0 9 * * *', tz: 'UTC' },
      conversationConfigSnapshot: {
        prompt: 'Check things',
        provider: 'claude',
        autoApprove: false,
      },
      status: 'queued',
      triggerKind: 'manual',
    });

    const stepSpy = vi.fn();
    const { executor, release } = makeHeldExecutor();
    const scheduler = new AutomationScheduler(makeCallbacks(stepSpy), executor);
    await scheduler.drainQueue();

    // Scheduler calls onRunStep after startCreatingTask
    expect(stepSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: run.id, status: 'creating_task' })
    );

    release();
    await vi.waitFor(() => expect(getRunRow(fixture, run.id)?.status).toBe('done'));
  });
});

// ---------------------------------------------------------------------------
// Worker error handling
// ---------------------------------------------------------------------------

describe('AutomationScheduler worker error handling', () => {
  it('marks the run failed when the executor throws unexpectedly', async () => {
    seedProject(fixture);
    const automationId = seedAutomation(fixture);

    const run = await insertRun({
      automationId,
      triggerConfigSnapshot: { expr: '0 9 * * *', tz: 'UTC' },
      conversationConfigSnapshot: {
        prompt: 'Check things',
        provider: 'claude',
        autoApprove: false,
      },
      status: 'queued',
      triggerKind: 'manual',
    });

    const scheduler = new AutomationScheduler(makeCallbacks(), throwingExecutor);
    await scheduler.drainQueue();

    await vi.waitFor(() => {
      const row = getRunRow(fixture, run.id);
      expect(row?.status).toBe('failed');
    });

    const row = getRunRow(fixture, run.id);
    expect(row?.error).toContain('boom');
  });
});
