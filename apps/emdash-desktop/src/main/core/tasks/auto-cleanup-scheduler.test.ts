import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  archiveTask: vi.fn(),
  deleteTask: vi.fn(),
  dbSelect: vi.fn(),
}));

vi.mock('@main/core/settings/settings-service', () => ({
  appSettingsService: {
    get: mocks.getSettings,
  },
}));
vi.mock('@main/core/tasks/operations/archiveTask', () => ({
  archiveTask: mocks.archiveTask,
}));
vi.mock('@main/core/tasks/operations/deleteTask', () => ({
  deleteTask: mocks.deleteTask,
}));
vi.mock('@main/db/client', () => ({
  db: { select: mocks.dbSelect },
}));
vi.mock('@main/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@main/lib/telemetry', () => ({
  telemetryService: { capture: vi.fn() },
}));

import { AutoCleanupScheduler } from './auto-cleanup-scheduler';

const FIXED_NOW = new Date('2026-06-25T12:00:00.000Z');

function setSettings(overrides: Partial<{
  autoCleanupMergedEnabled: boolean;
  autoCleanupMergedAction: 'archive' | 'delete';
  autoCleanupMergedDeleteBranch: boolean;
  autoCleanupMergedDelayMs: number;
}>) {
  mocks.getSettings.mockResolvedValue({
    autoGenerateName: true,
    autoApproveByDefault: false,
    autoTrustWorktrees: true,
    createBranchAndWorktree: true,
    preserveNameCapitalization: false,
    includeIssueContextByDefault: true,
    autoCleanupMergedEnabled: false,
    autoCleanupMergedAction: 'archive',
    autoCleanupMergedDeleteBranch: false,
    autoCleanupMergedDelayMs: 24 * 60 * 60 * 1000,
    ...overrides,
  });
}

function setCandidates(rows: Array<{ taskId: string; projectId: string; prUrl: string }>) {
  // The scheduler is expected to issue exactly one db.select(...).from(...)...
  // chain that returns the candidate rows. Test-friendly: stub the whole chain.
  const chain: { [k: string]: unknown } = {};
  const ret = rows;
  const all = () => Promise.resolve(ret);
  Object.assign(chain, {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    groupBy: () => chain,
    having: () => chain,
    orderBy: () => chain,
    all,
    then: (resolve: (v: typeof ret) => void) => Promise.resolve(ret).then(resolve),
  });
  mocks.dbSelect.mockReturnValue(chain);
}

describe('AutoCleanupScheduler.runOnce', () => {
  let scheduler: AutoCleanupScheduler;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    vi.clearAllMocks();
    scheduler = new AutoCleanupScheduler();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does nothing when feature is disabled', async () => {
    setSettings({ autoCleanupMergedEnabled: false });
    await scheduler.runOnce();
    expect(mocks.dbSelect).not.toHaveBeenCalled();
    expect(mocks.archiveTask).not.toHaveBeenCalled();
    expect(mocks.deleteTask).not.toHaveBeenCalled();
  });

  it('archives each candidate when action is archive', async () => {
    setSettings({ autoCleanupMergedEnabled: true, autoCleanupMergedAction: 'archive' });
    setCandidates([
      { taskId: 't1', projectId: 'p1', prUrl: 'https://gh/p/r/pull/1' },
      { taskId: 't2', projectId: 'p1', prUrl: 'https://gh/p/r/pull/2' },
    ]);
    mocks.archiveTask.mockResolvedValue(undefined);

    await scheduler.runOnce();

    expect(mocks.archiveTask).toHaveBeenCalledTimes(2);
    expect(mocks.archiveTask).toHaveBeenCalledWith('p1', 't1');
    expect(mocks.archiveTask).toHaveBeenCalledWith('p1', 't2');
    expect(mocks.deleteTask).not.toHaveBeenCalled();
  });

  it('deletes with deleteBranch=true when configured', async () => {
    setSettings({
      autoCleanupMergedEnabled: true,
      autoCleanupMergedAction: 'delete',
      autoCleanupMergedDeleteBranch: true,
    });
    setCandidates([{ taskId: 't1', projectId: 'p1', prUrl: 'https://gh/p/r/pull/1' }]);
    mocks.deleteTask.mockResolvedValue(undefined);

    await scheduler.runOnce();

    expect(mocks.deleteTask).toHaveBeenCalledWith('p1', 't1', {
      deleteWorktree: true,
      deleteBranch: true,
    });
    expect(mocks.archiveTask).not.toHaveBeenCalled();
  });

  it('deletes with deleteBranch=false by default', async () => {
    setSettings({
      autoCleanupMergedEnabled: true,
      autoCleanupMergedAction: 'delete',
      autoCleanupMergedDeleteBranch: false,
    });
    setCandidates([{ taskId: 't1', projectId: 'p1', prUrl: 'https://gh/p/r/pull/1' }]);
    mocks.deleteTask.mockResolvedValue(undefined);

    await scheduler.runOnce();

    expect(mocks.deleteTask).toHaveBeenCalledWith('p1', 't1', {
      deleteWorktree: true,
      deleteBranch: false,
    });
  });

  it('continues processing if a single task action throws', async () => {
    setSettings({ autoCleanupMergedEnabled: true, autoCleanupMergedAction: 'archive' });
    setCandidates([
      { taskId: 't1', projectId: 'p1', prUrl: 'https://gh/p/r/pull/1' },
      { taskId: 't2', projectId: 'p1', prUrl: 'https://gh/p/r/pull/2' },
    ]);
    mocks.archiveTask.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined);

    await scheduler.runOnce();

    expect(mocks.archiveTask).toHaveBeenCalledTimes(2);
  });

  it('does not throw if the DB query fails', async () => {
    setSettings({ autoCleanupMergedEnabled: true });
    mocks.dbSelect.mockImplementation(() => {
      throw new Error('db down');
    });
    await expect(scheduler.runOnce()).resolves.toBeUndefined();
    expect(mocks.archiveTask).not.toHaveBeenCalled();
  });
});
