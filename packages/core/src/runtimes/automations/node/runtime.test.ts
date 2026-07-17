import { ok } from '@emdash/shared';
import { ManualClock } from '@emdash/shared/testing';
import { LOCAL_HOST_REF } from '@primitives/host/api';
import type { TempStoreHandle } from '@primitives/sqlite-store/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutomationDeployment } from '../api/deployment';
import type { AutomationSessionPort, AutomationWorkspacePort } from './ports';
import { AutomationsRuntime } from './runtime';
import type { AutomationsDb } from './sqlite/store';
import { automationsStore } from './sqlite/store';
import { AutomationDeploymentStore } from './storage/deployment-store';

const MINUTE = 60_000;
const START = Date.UTC(2026, 6, 16, 8, 59);

const worktree = {
  host: LOCAL_HOST_REF,
  path: { root: { kind: 'posix' as const }, segments: ['tmp', 'wt-1'] },
};

function deployment(overrides: Partial<AutomationDeployment> = {}): AutomationDeployment {
  return {
    automationId: 'auto-1',
    enabled: true,
    name: 'Nightly',
    schedule: { expr: '0 9 * * *', tz: 'UTC' },
    agent: {
      type: 'acp' as const,
      start: {
        providerId: 'claude',
        model: null,
        initialQueue: [{ text: 'Review open PRs' }],
      },
    },
    workspace: {
      kind: 'worktree' as const,
      repository: {
        host: LOCAL_HOST_REF,
        path: { root: { kind: 'posix' as const }, segments: ['repo'] },
      },
      preservePatterns: ['.env*'],
      git: {
        kind: 'create-branch' as const,
        fromBranch: { type: 'local' as const, branch: 'main' },
        pushRemote: null,
      },
    },
    updatedAt: START,
    ...overrides,
  };
}

function fakeWorkspacePort(): AutomationWorkspacePort {
  return {
    provision: vi.fn(() => Promise.resolve(ok({ workspace: worktree, branchName: 'emdash-abc' }))),
  };
}

function fakeSessionPort(): AutomationSessionPort {
  return {
    start: vi.fn(() => Promise.resolve(ok({ sessionId: 'sess-1' }))),
  };
}

function runsOf(runtime: AutomationsRuntime, automationIds: string[]) {
  const result = runtime.getRuns({ sinceSeq: 0, automationIds });
  if (!result.success) throw new Error('getRuns failed');
  return result.data.runs;
}

describe('AutomationsRuntime', () => {
  let handle: TempStoreHandle<AutomationsDb>;
  let clock: ManualClock;
  let runtime: AutomationsRuntime;
  let workspacePort: AutomationWorkspacePort;
  let sessionPort: AutomationSessionPort;

  beforeEach(async () => {
    handle = await automationsStore.openTemp();
    clock = new ManualClock(START);
    workspacePort = fakeWorkspacePort();
    sessionPort = fakeSessionPort();
    runtime = new AutomationsRuntime({
      handle,
      workspacePort,
      sessionPort,
      clock,
      tickIntervalMs: MINUTE,
    });
    runtime.start();
  });

  afterEach(async () => {
    await runtime.dispose();
    handle.close();
  });

  it('deploy creates a scheduled run', async () => {
    const deployResult = await runtime.deploy(deployment());
    expect(deployResult.success).toBe(true);

    const runs = runsOf(runtime, ['auto-1']);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      automationId: 'auto-1',
      status: 'scheduled',
      triggerKind: 'cron',
    });
  });

  it('deploy rejects an invalid schedule without persisting or scheduling it', async () => {
    const result = await runtime.deploy(deployment({ schedule: { expr: '0 9 * *', tz: 'UTC' } }));

    expect(result).toEqual({
      success: false,
      error: {
        type: 'invalid-schedule',
        reason: 'malformed_expression',
        message: 'Cron expression must contain exactly five fields',
      },
    });
    expect(new AutomationDeploymentStore(handle).getDeployment('auto-1')).toBeNull();
    expect(runsOf(runtime, ['auto-1'])).toHaveLength(0);
  });

  it('redeploy with a new schedule skips the old scheduled run', async () => {
    await runtime.deploy(deployment());
    expect(runsOf(runtime, ['auto-1'])[0]?.status).toBe('scheduled');

    await runtime.deploy(deployment({ schedule: { expr: '30 9 * * *', tz: 'UTC' } }));

    const runs = runsOf(runtime, ['auto-1']);
    const statuses = runs.map((run) => run.status);
    expect(statuses).toContain('skipped');
    expect(statuses).toContain('scheduled');
  });

  it('redeploy disabling skips the scheduled run', async () => {
    await runtime.deploy(deployment());
    await runtime.deploy(deployment({ enabled: false }));

    const runs = runsOf(runtime, ['auto-1']);
    const statuses = runs.map((run) => run.status);
    expect(statuses).toContain('skipped');
    expect(statuses.filter((s) => s === 'scheduled')).toHaveLength(0);
  });

  it('ignores a stale deployment revision', async () => {
    const current = deployment({
      name: 'Current',
      schedule: { expr: '30 9 * * *', tz: 'UTC' },
      updatedAt: START + 2,
    });
    await runtime.deploy(current);

    const result = await runtime.deploy(
      deployment({
        name: 'Stale',
        schedule: { expr: '45 9 * * *', tz: 'UTC' },
        updatedAt: START + 1,
      })
    );

    expect(result).toEqual(
      ok({
        deployment: current,
        deployedAt: START,
      })
    );
    const scheduled = runsOf(runtime, ['auto-1']).filter((run) => run.status === 'scheduled');
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.configSnapshot.name).toBe('Current');
  });

  it('remove returns automation-not-found for missing id', async () => {
    const result = await runtime.remove({ automationId: 'missing' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.type).toBe('automation-not-found');
  });

  it('remove deletes deployment and all runs', async () => {
    await runtime.deploy(deployment());
    expect(runsOf(runtime, ['auto-1']).length).toBeGreaterThan(0);

    const result = await runtime.remove({ automationId: 'auto-1' });
    expect(result.success).toBe(true);
    expect(runsOf(runtime, ['auto-1'])).toHaveLength(0);
  });

  it('startRun creates a manual run and executes it', async () => {
    await runtime.deploy(deployment());
    const result = await runtime.startRun({ automationId: 'auto-1' });
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.run).toMatchObject({
      automationId: 'auto-1',
      triggerKind: 'manual',
    });

    await runtime.dispose();
    runtime = new AutomationsRuntime({ handle, workspacePort, sessionPort, clock });

    expect(workspacePort.provision).toHaveBeenCalled();
  });

  it('startRun errors for missing automation', async () => {
    const result = await runtime.startRun({ automationId: 'missing' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.type).toBe('automation-not-found');
  });

  it('startRun errors for disabled automation', async () => {
    await runtime.deploy(deployment({ enabled: false }));
    const result = await runtime.startRun({ automationId: 'auto-1' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.type).toBe('automation-disabled');
  });

  it('cancelRun errors for missing run', () => {
    const result = runtime.cancelRun({ runId: 'missing' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.type).toBe('run-not-found');
  });

  it('getRuns paginates with nextSeq', async () => {
    await runtime.deploy(deployment());
    await runtime.deploy(deployment({ automationId: 'auto-2' }));

    const page1 = runtime.getRuns({
      sinceSeq: 0,
      automationIds: ['auto-1', 'auto-2'],
      limit: 1,
    });
    expect(page1.success).toBe(true);
    if (!page1.success) return;
    expect(page1.data.runs).toHaveLength(1);

    const page2 = runtime.getRuns({
      sinceSeq: page1.data.nextSeq,
      automationIds: ['auto-1', 'auto-2'],
      limit: 10,
    });
    expect(page2.success).toBe(true);
    if (!page2.success) return;
    expect(page2.data.runs).toHaveLength(1);
    expect(page2.data.nextSeq).toBeGreaterThan(page1.data.nextSeq);
  });
});
