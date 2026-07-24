import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import type {
  AutomationRun,
  AutomationRunStatus,
  GetRunOverviewResult,
} from '@emdash/core/runtimes/automations/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AutomationRunStore } from './automation-run-store';

const mocks = vi.hoisted(() => ({
  getRunOverview: vi.fn(),
  listChangedRuns: vi.fn(),
  listRuns: vi.fn(),
  onEvent: undefined as ((event: { run: AutomationRun }) => void) | undefined,
  onGap: undefined as (() => void) | undefined,
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock('@renderer/lib/runtime/desktop-wire-client', () => ({
  getDesktopWireClient: async () => ({
    automations: {
      getRunOverview: mocks.getRunOverview,
      listChangedRuns: mocks.listChangedRuns,
      listRuns: mocks.listRuns,
      runEvents: { subscribe: mocks.subscribe },
    },
  }),
}));

function runFixture({
  id = 'run-1',
  seq = 1,
  status = 'done',
}: {
  id?: string;
  seq?: number;
  status?: AutomationRunStatus;
} = {}): AutomationRun {
  return {
    id,
    seq,
    automationId: 'automation-1',
    status,
    triggerKind: 'manual',
    configSnapshot: {
      name: 'Review changes',
      schedule: { expr: '0 9 * * *', tz: 'UTC' },
      agent: {
        type: 'acp',
        start: {
          providerId: 'claude',
          model: null,
          initialQueue: [{ text: 'Review changes' }],
        },
      },
      workspace: {
        kind: 'worktree',
        repository: {
          host: LOCAL_HOST_REF,
          path: { root: { kind: 'posix' }, segments: ['repo'] },
        },
        worktreePoolPath: {
          root: { kind: 'posix' },
          segments: ['worktrees', 'repo-12345678'],
        },
        baseRemote: 'origin',
        preservePatterns: [],
        git: {
          kind: 'create-branch',
          fromBranch: { type: 'local', branch: 'main' },
          pushRemote: null,
        },
      },
    },
    generatedName: id,
    scheduledAt: null,
    deadlineAt: null,
    startedAt: null,
    finishedAt: status === 'scheduled' ? null : 100,
    workspace: null,
    branchName: null,
    conversationId: null,
    sessionId: null,
    error: null,
  };
}

function overview(
  latestRun: AutomationRun | null,
  counts: Partial<GetRunOverviewResult['counts']> = {}
): GetRunOverviewResult {
  return {
    counts: {
      scheduled: 0,
      queued: 0,
      provisioning_workspace: 0,
      starting_session: 0,
      done: 0,
      failed: 0,
      skipped: 0,
      cancelled: 0,
      ...counts,
    },
    latestRun,
    nextScheduledRun: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.onEvent = undefined;
  mocks.onGap = undefined;
  mocks.subscribe.mockImplementation(
    async (
      _key: unknown,
      handlers: { onEvent: (event: { run: AutomationRun }) => void; onGap: () => void }
    ) => {
      mocks.onEvent = handlers.onEvent;
      mocks.onGap = handlers.onGap;
      return mocks.unsubscribe;
    }
  );
});

describe('AutomationRunStore overview', () => {
  it('updates counts from events without refetching the overview', async () => {
    const initialRun = runFixture();
    mocks.getRunOverview.mockResolvedValue({
      success: true,
      data: overview(initialRun, { done: 1 }),
    });
    const store = new AutomationRunStore('project-1', 'automation-1');
    const release = store.acquire();
    await vi.waitFor(() => expect(mocks.getRunOverview).toHaveBeenCalledOnce());

    mocks.onEvent?.({ run: runFixture({ seq: 2, status: 'failed' }) });

    expect(store.counts.done).toBe(0);
    expect(store.counts.failed).toBe(1);
    expect(mocks.getRunOverview).toHaveBeenCalledOnce();

    release();
  });

  it('catches up and refreshes the authoritative overview after a stream gap', async () => {
    const initialRun = runFixture();
    const changedRun = runFixture({ seq: 2, status: 'failed' });
    mocks.getRunOverview
      .mockResolvedValueOnce({ success: true, data: overview(initialRun, { done: 1 }) })
      .mockResolvedValueOnce({ success: true, data: overview(changedRun, { failed: 1 }) });
    mocks.listChangedRuns
      .mockResolvedValueOnce({ success: true, data: { runs: [changedRun], nextSeq: 2 } })
      .mockResolvedValueOnce({ success: true, data: { runs: [], nextSeq: 2 } });
    const store = new AutomationRunStore('project-1', 'automation-1');
    const release = store.acquire();
    await vi.waitFor(() => expect(mocks.getRunOverview).toHaveBeenCalledOnce());

    mocks.onGap?.();

    await vi.waitFor(() => expect(mocks.getRunOverview).toHaveBeenCalledTimes(2));
    expect(mocks.listChangedRuns).toHaveBeenCalledTimes(2);
    expect(store.counts.done).toBe(0);
    expect(store.counts.failed).toBe(1);

    release();
  });

  it('refreshes counts when an event changes a run that was not in the overview snapshot', async () => {
    const laterRun = runFixture({ id: 'run-2', seq: 2, status: 'skipped' });
    const completedRun = runFixture({ id: 'run-1', seq: 3, status: 'done' });
    mocks.getRunOverview
      .mockResolvedValueOnce({
        success: true,
        data: overview(laterRun, { starting_session: 1, skipped: 1 }),
      })
      .mockResolvedValueOnce({
        success: true,
        data: overview(completedRun, { done: 1, skipped: 1 }),
      });
    const store = new AutomationRunStore('project-1', 'automation-1');
    const release = store.acquire();
    await vi.waitFor(() => expect(mocks.getRunOverview).toHaveBeenCalledOnce());

    mocks.onEvent?.({ run: completedRun });

    await vi.waitFor(() => expect(mocks.getRunOverview).toHaveBeenCalledTimes(2));
    expect(store.counts.starting_session).toBe(0);
    expect(store.counts.done).toBe(1);
    expect(store.counts.skipped).toBe(1);

    release();
  });

  it('clears the next scheduled run when that run leaves the scheduled state', async () => {
    const scheduledRun = runFixture({ status: 'scheduled' });
    mocks.getRunOverview.mockResolvedValue({
      success: true,
      data: { ...overview(null, { scheduled: 1 }), nextScheduledRun: scheduledRun },
    });
    const store = new AutomationRunStore('project-1', 'automation-1');
    const release = store.acquire();
    await vi.waitFor(() => expect(store.nextScheduledRun?.id).toBe(scheduledRun.id));

    mocks.onEvent?.({ run: runFixture({ seq: 2, status: 'skipped' }) });

    expect(store.nextScheduledRun).toBeNull();
    expect(mocks.getRunOverview).toHaveBeenCalledOnce();
    release();
  });

  it('catches up loaded history after the last consumer releases and reconnects', async () => {
    const firstRun = runFixture();
    const missedRun = runFixture({ id: 'run-2', seq: 2, status: 'failed' });
    mocks.getRunOverview
      .mockResolvedValueOnce({ success: true, data: overview(firstRun, { done: 1 }) })
      .mockResolvedValueOnce({
        success: true,
        data: overview(missedRun, { done: 1, failed: 1 }),
      });
    mocks.listRuns.mockResolvedValue({ success: true, data: { runs: [firstRun] } });
    mocks.listChangedRuns
      .mockResolvedValueOnce({ success: true, data: { runs: [missedRun], nextSeq: 2 } })
      .mockResolvedValueOnce({ success: true, data: { runs: [], nextSeq: 2 } });
    const store = new AutomationRunStore('project-1', 'automation-1');
    const release = store.acquire();
    await vi.waitFor(() => expect(mocks.getRunOverview).toHaveBeenCalledOnce());
    await store.loadInitialHistory('all', 25);
    release();

    const releaseAgain = store.acquire();

    await vi.waitFor(() => expect(mocks.getRunOverview).toHaveBeenCalledTimes(2));
    expect(store.history('all').map((run) => run.id)).toEqual(['run-2', 'run-1']);
    expect(mocks.subscribe).toHaveBeenCalledTimes(2);
    releaseAgain();
  });
});
