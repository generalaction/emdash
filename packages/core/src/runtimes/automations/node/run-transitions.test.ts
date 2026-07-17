import { LOCAL_HOST_REF } from '@primitives/host/api';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TempStoreHandle } from '@primitives/sqlite-store/api';
import type { AutomationRun } from '../api/run';
import type { AutomationsDb } from './sqlite/store';
import { automationsStore } from './sqlite/store';
import { AutomationRunStore } from './storage/run-store';
import { AutomationRunTransitions, INTERRUPTED_BY_RESTART } from './run-transitions';

const worktree = {
  host: LOCAL_HOST_REF,
  path: { root: { kind: 'posix' as const }, segments: ['tmp', 'wt-1'] },
};

const configSnapshot = {
  name: 'Nightly',
  schedule: { expr: '0 9 * * *', tz: 'America/Los_Angeles' },
  agent: {
    type: 'acp' as const,
    providerId: 'claude',
    prompt: 'Review open PRs',
    model: null,
    autoApprove: true,
  },
  repository: {
    host: LOCAL_HOST_REF,
    path: { root: { kind: 'posix' as const }, segments: ['Users', 'jona', 'repo'] },
  },
  git: {
    kind: 'create-branch' as const,
    fromBranch: { type: 'local' as const, branch: 'main' },
    pushBranch: true,
  },
  workspace: { kind: 'worktree' as const },
};

function newRun(overrides: Partial<Omit<AutomationRun, 'seq'>> = {}): Omit<AutomationRun, 'seq'> {
  return {
    id: 'run-1',
    automationId: 'auto-1',
    status: 'scheduled',
    triggerKind: 'cron',
    configSnapshot,
    generatedName: 'emdash-abc',
    scheduledAt: 1_000,
    deadlineAt: null,
    startedAt: null,
    finishedAt: null,
    worktree: null,
    branchName: null,
    conversationId: null,
    sessionId: null,
    error: null,
    ...overrides,
  };
}

describe('AutomationRunTransitions', () => {
  let handle: TempStoreHandle<AutomationsDb>;
  let runStore: AutomationRunStore;
  let changed: AutomationRun[];
  let transitions: AutomationRunTransitions;

  beforeEach(async () => {
    handle = await automationsStore.openTemp();
    runStore = new AutomationRunStore(handle);
    changed = [];
    transitions = new AutomationRunTransitions({
      runStore,
      onRunChanged: (run) => changed.push(run),
    });
  });

  afterEach(() => {
    handle.close();
  });

  it('walks the happy path and claims a fresh seq on every transition', () => {
    const inserted = runStore.insertRun(newRun());
    expect(inserted).not.toBeNull();

    const queued = transitions.markQueued('run-1');
    const claimed = transitions.claimQueued('run-1', 2_000);
    const starting = transitions.markStartingSession('run-1', { worktree, branchName: 'emdash-abc' });
    const running = transitions.markRunning('run-1', {
      conversationId: 'conv-1',
      sessionId: 'sess-1',
    });
    const done = transitions.markDone('run-1', 3_000);

    expect(queued?.status).toBe('queued');
    expect(claimed?.startedAt).toBe(2_000);
    expect(starting?.worktree).toEqual(worktree);
    expect(starting?.branchName).toBe('emdash-abc');
    expect(running?.conversationId).toBe('conv-1');
    expect(running?.sessionId).toBe('sess-1');
    expect(done?.status).toBe('done');
    expect(done?.finishedAt).toBe(3_000);

    const seqs = [inserted, queued, claimed, starting, running, done].map((run) => run?.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => (a ?? 0) - (b ?? 0)));
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it('reports every successful transition and nothing on a lost race', () => {
    runStore.insertRun(newRun());

    transitions.markQueued('run-1');
    transitions.claimQueued('run-1', 2_000);
    expect(changed.map((run) => run.status)).toEqual(['queued', 'provisioning_workspace']);

    // Second claim loses the CAS: no transition, no report.
    expect(transitions.claimQueued('run-1', 2_500)).toBeNull();
    expect(changed).toHaveLength(2);
  });

  it('returns null when the source status does not match', () => {
    runStore.insertRun(newRun());

    expect(transitions.markDone('run-1', 3_000)).toBeNull();
    expect(transitions.markRunning('run-1', { conversationId: 'c', sessionId: 's' })).toBeNull();
    expect(transitions.markQueued('missing-run')).toBeNull();
    expect(changed).toHaveLength(0);
  });

  it('fails a run from any non-terminal status but never from a terminal one', () => {
    runStore.insertRun(newRun());
    transitions.markQueued('run-1');
    transitions.claimQueued('run-1', 2_000);

    const failed = transitions.markFailed(
      'run-1',
      { step: 'provision_workspace', code: 'worktree_create_failed' },
      3_000
    );
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toEqual({ step: 'provision_workspace', code: 'worktree_create_failed' });
    expect(failed?.finishedAt).toBe(3_000);

    expect(
      transitions.markFailed('run-1', { step: 'run', code: 'cancelled' }, 4_000)
    ).toBeNull();
  });

  it('skips runs only before a worker has claimed them', () => {
    runStore.insertRun(newRun());
    const skipped = transitions.markSkipped(
      'run-1',
      { step: 'queue', code: 'deadline_exceeded' },
      2_000
    );
    expect(skipped?.status).toBe('skipped');

    runStore.insertRun(newRun({ id: 'run-2', scheduledAt: 1_500 }));
    transitions.markQueued('run-2');
    transitions.claimQueued('run-2', 2_000);
    expect(
      transitions.markSkipped('run-2', { step: 'queue', code: 'automation_deleted' }, 2_500)
    ).toBeNull();
  });

  it('interrupts in-flight runs with the step matching their stuck status', () => {
    runStore.insertRun(newRun());
    transitions.markQueued('run-1');
    transitions.claimQueued('run-1', 2_000);

    const stuck = runStore.getRun('run-1');
    expect(stuck?.status).toBe('provisioning_workspace');
    if (!stuck) throw new Error('run missing');

    const interrupted = transitions.markInterrupted(stuck, 3_000);
    expect(interrupted?.status).toBe('failed');
    expect(interrupted?.error).toEqual({
      step: 'provision_workspace',
      code: INTERRUPTED_BY_RESTART,
    });
  });

  it('rejects interrupting runs that are not in-flight', () => {
    const inserted = runStore.insertRun(newRun());
    if (!inserted) throw new Error('insert failed');
    expect(() => transitions.markInterrupted(inserted, 3_000)).toThrow(/not in-flight/);
  });
});
