import { ok, err } from '@emdash/shared';
import { LOCAL_HOST_REF } from '@primitives/host/api';
import type { TempStoreHandle } from '@primitives/sqlite-store/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutomationRun } from '../../api/run';
import { AutomationRunStore } from '../persistence/run-store';
import type { AutomationsDb } from '../persistence/store';
import { automationsStore } from '../persistence/store';
import type { AutomationPortError } from '../ports/port-error';
import type { AutomationSessionPort } from '../ports/session-start';
import type { AutomationWorkspacePort } from '../ports/workspace-provisioning';
import { createAutomationRunExecutor } from './executor';
import { AutomationRunTransitions } from './transitions';

const worktree = {
  host: LOCAL_HOST_REF,
  path: { root: { kind: 'posix' as const }, segments: ['tmp', 'wt-1'] },
};

const configSnapshot = {
  name: 'Nightly',
  schedule: { expr: '0 9 * * *', tz: 'America/Los_Angeles' },
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
      path: { root: { kind: 'posix' as const }, segments: ['Users', 'jona', 'repo'] },
    },
    preservePatterns: ['.env*'],
    git: {
      kind: 'create-branch' as const,
      fromBranch: { type: 'local' as const, branch: 'main' },
      pushRemote: 'fork',
    },
  },
};

function claimedRun(
  handle: TempStoreHandle<AutomationsDb>,
  overrides: Partial<Omit<AutomationRun, 'seq'>> = {}
): AutomationRun {
  const runStore = new AutomationRunStore(handle);
  const transitions = new AutomationRunTransitions({ runStore });
  const inserted = runStore.insertRun({
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
    workspace: null,
    branchName: null,
    conversationId: null,
    sessionId: null,
    error: null,
    ...overrides,
  });
  if (!inserted) throw new Error('insert failed');
  transitions.markQueued(inserted.id);
  const claimed = transitions.claimQueued(inserted.id, 2_000);
  if (!claimed) throw new Error('claim failed');
  return claimed;
}

function fakeWorkspacePort(
  result: () => ReturnType<AutomationWorkspacePort['provision']> = () =>
    Promise.resolve(ok({ workspace: worktree, branchName: 'emdash-abc' }))
): AutomationWorkspacePort {
  return { provision: vi.fn(result) };
}

function fakeSessionPort(options?: {
  start?: () => ReturnType<AutomationSessionPort['start']>;
}): AutomationSessionPort {
  return {
    start: vi.fn(options?.start ?? (() => Promise.resolve(ok({ sessionId: 'sess-1' })))),
  };
}

describe('createAutomationRunExecutor', () => {
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

  it('walks the happy path: provision, start session, done', async () => {
    const run = claimedRun(handle);
    const workspace = fakeWorkspacePort();
    const session = fakeSessionPort();
    const executor = createAutomationRunExecutor({
      transitions,
      workspacePort: workspace,
      sessionPort: session,
      createConversationId: () => 'conv-1',
    });

    await executor(run, new AbortController().signal);

    const final = runStore.getRun('run-1');
    expect(final?.status).toBe('done');
    expect(final?.workspace).toEqual(worktree);
    expect(final?.branchName).toBe('emdash-abc');
    expect(final?.conversationId).toBe('conv-1');
    expect(final?.sessionId).toBe('sess-1');
    expect(final?.finishedAt).toBeTypeOf('number');

    expect(changed.map((run) => run.status)).toEqual(['starting_session', 'done']);
  });

  it('fails with step provision_workspace on workspace port failure', async () => {
    const run = claimedRun(handle);
    const portError: AutomationPortError = { code: 'worktree_create_failed' };
    const workspace = fakeWorkspacePort(() => Promise.resolve(err(portError)));
    const session = fakeSessionPort();
    const executor = createAutomationRunExecutor({
      transitions,
      workspacePort: workspace,
      sessionPort: session,
    });

    await executor(run, new AbortController().signal);

    const final = runStore.getRun('run-1');
    expect(final?.status).toBe('failed');
    expect(final?.error?.step).toBe('provision_workspace');
    expect(final?.error?.code).toBe('worktree_create_failed');
    expect(session.start).not.toHaveBeenCalled();
  });

  it('fails with step start_session on session start failure', async () => {
    const run = claimedRun(handle);
    const portError: AutomationPortError = { code: 'provider_unavailable' };
    const workspace = fakeWorkspacePort();
    const session = fakeSessionPort({
      start: () => Promise.resolve(err(portError)),
    });
    const executor = createAutomationRunExecutor({
      transitions,
      workspacePort: workspace,
      sessionPort: session,
    });

    await executor(run, new AbortController().signal);

    const final = runStore.getRun('run-1');
    expect(final?.status).toBe('failed');
    expect(final?.error?.step).toBe('start_session');
    expect(final?.error?.code).toBe('provider_unavailable');
  });

  it('does not overwrite terminal state when the run was externally terminalized', async () => {
    const run = claimedRun(handle);
    const workspace = fakeWorkspacePort(async () => {
      transitions.markFailed(
        run.id,
        { step: 'provision_workspace', code: 'external_cancel' },
        5_000
      );
      return ok({ workspace: worktree, branchName: 'emdash-abc' });
    });
    const session = fakeSessionPort();
    const executor = createAutomationRunExecutor({
      transitions,
      workspacePort: workspace,
      sessionPort: session,
    });

    await executor(run, new AbortController().signal);

    const final = runStore.getRun('run-1');
    expect(final?.status).toBe('failed');
    expect(final?.error?.code).toBe('external_cancel');
    expect(session.start).not.toHaveBeenCalled();
  });
});
