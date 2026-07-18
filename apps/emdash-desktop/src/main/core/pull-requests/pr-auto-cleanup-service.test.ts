import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrAutoCleanupCandidate } from './pr-auto-cleanup-candidates';
import {
  cleanupMergedPrTask,
  PrAutoCleanupService,
  type PrAutoCleanupDependencies,
  type PrAutoCleanupMarker,
} from './pr-auto-cleanup-service';

const taskServiceMocks = vi.hoisted(() => ({
  teardown: vi.fn(),
  archiveTask: vi.fn(),
  deleteTask: vi.fn(),
}));

vi.mock('@main/core/settings/settings-service', () => ({
  appSettingsService: { get: vi.fn() },
}));

vi.mock('@main/core/tasks/task-service', () => ({
  taskService: taskServiceMocks,
}));

vi.mock('@main/db/client', () => ({
  db: {},
}));

vi.mock('@main/db/kv', () => ({
  KV: class {
    get = vi.fn();
    setOrThrow = vi.fn();
  },
}));

vi.mock('@main/lib/events', () => ({
  events: { emit: vi.fn() },
}));

const candidate: PrAutoCleanupCandidate = {
  taskId: 'task-1',
  projectId: 'project-1',
  taskName: 'Fix cleanup',
  prUrl: 'https://github.com/acme/repo/pull/42',
};

describe('production auto-cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['archive', 'archive'],
    ['delete', 'terminate'],
  ] as const)('does not %s when teardown fails', async (action, teardownMode) => {
    taskServiceMocks.teardown.mockResolvedValue({
      success: false,
      error: { type: 'error', message: 'teardown failed' },
    });

    await expect(cleanupMergedPrTask(candidate, action)).rejects.toThrow('teardown failed');

    expect(taskServiceMocks.teardown).toHaveBeenCalledWith(candidate.taskId, teardownMode);
    expect(taskServiceMocks.archiveTask).not.toHaveBeenCalled();
    expect(taskServiceMocks.deleteTask).not.toHaveBeenCalled();
  });

  it.each([
    ['archive', 'archive'],
    ['delete', 'terminate'],
  ] as const)('runs %s after teardown succeeds', async (action, teardownMode) => {
    taskServiceMocks.teardown.mockResolvedValue({ success: true, data: undefined });

    await cleanupMergedPrTask(candidate, action);

    expect(taskServiceMocks.teardown).toHaveBeenCalledWith(candidate.taskId, teardownMode);
    if (action === 'archive') {
      expect(taskServiceMocks.archiveTask).toHaveBeenCalledWith(
        candidate.projectId,
        candidate.taskId
      );
      expect(taskServiceMocks.deleteTask).not.toHaveBeenCalled();
    } else {
      expect(taskServiceMocks.deleteTask).toHaveBeenCalledWith(
        candidate.projectId,
        candidate.taskId
      );
      expect(taskServiceMocks.archiveTask).not.toHaveBeenCalled();
    }
  });
});

describe('PrAutoCleanupService', () => {
  let mode: 'off' | 'archive' | 'delete';
  let active: boolean;
  let candidates: PrAutoCleanupCandidate[];
  let markers: Map<string, PrAutoCleanupMarker>;
  let cleanup: ReturnType<typeof vi.fn<PrAutoCleanupDependencies['cleanup']>>;
  let notify: ReturnType<typeof vi.fn<PrAutoCleanupDependencies['notify']>>;
  let listCandidates: ReturnType<typeof vi.fn<PrAutoCleanupDependencies['listCandidates']>>;
  let deps: PrAutoCleanupDependencies;

  beforeEach(() => {
    mode = 'off';
    active = true;
    candidates = [candidate];
    markers = new Map();
    cleanup = vi.fn().mockResolvedValue(undefined);
    notify = vi.fn();
    listCandidates = vi.fn(async () => candidates);
    deps = {
      getMode: async () => mode,
      listCandidates,
      isTaskActive: async () => active,
      getMarker: async (taskId) => markers.get(taskId) ?? null,
      cleanup,
      setMarker: async (taskId, marker) => {
        markers.set(taskId, marker);
      },
      notify,
    };
  });

  it('does nothing when automatic cleanup is off', async () => {
    const service = new PrAutoCleanupService(deps);

    await service.processRepository('https://github.com/acme/repo');

    expect(listCandidates).not.toHaveBeenCalled();
    expect(cleanup).not.toHaveBeenCalled();
  });

  it.each(['archive', 'delete'] as const)('runs the selected %s action', async (action) => {
    mode = action;
    const service = new PrAutoCleanupService(deps);

    await service.processRepository('https://github.com/acme/repo');

    expect(cleanup).toHaveBeenCalledWith(candidate, action);
    expect(markers.get(candidate.taskId)).toEqual({
      version: 1,
      prUrl: candidate.prUrl,
      action,
      completedAt: expect.any(String),
    });
    expect(notify).toHaveBeenCalledWith(candidate, action);
  });

  it('leaves the marker absent after failure and retries on a later sync', async () => {
    mode = 'archive';
    cleanup.mockRejectedValueOnce(new Error('teardown failed')).mockResolvedValueOnce(undefined);
    const service = new PrAutoCleanupService(deps);

    await service.processRepository('https://github.com/acme/repo');
    expect(markers.has(candidate.taskId)).toBe(false);
    expect(notify).not.toHaveBeenCalled();

    await service.processRepository('https://github.com/acme/repo');
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(markers.get(candidate.taskId)?.prUrl).toBe(candidate.prUrl);
    expect(notify).toHaveBeenCalledOnce();
  });

  it('does not clean the same PR again after a task is restored', async () => {
    mode = 'archive';
    const service = new PrAutoCleanupService(deps);

    await service.processRepository('https://github.com/acme/repo');
    expect(cleanup).toHaveBeenCalledTimes(1);

    // Restoration makes the task active again, but intentionally preserves its marker.
    active = true;
    await service.processRepository('https://github.com/acme/repo');
    expect(cleanup).toHaveBeenCalledTimes(1);

    candidates = [{ ...candidate, prUrl: 'https://github.com/acme/repo/pull/84' }];
    await service.processRepository('https://github.com/acme/repo');
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(markers.get(candidate.taskId)?.prUrl).toBe('https://github.com/acme/repo/pull/84');
  });

  it('ignores a stale candidate that is no longer active', async () => {
    mode = 'delete';
    active = false;
    const service = new PrAutoCleanupService(deps);

    await service.processRepository('https://github.com/acme/repo');

    expect(cleanup).not.toHaveBeenCalled();
    expect(markers.size).toBe(0);
  });

  it('does not repeat successful cleanup in-session when marker persistence fails', async () => {
    mode = 'archive';
    deps.setMarker = vi.fn().mockRejectedValue(new Error('database busy'));
    const service = new PrAutoCleanupService(deps);

    await service.processRepository('https://github.com/acme/repo');
    await service.processRepository('https://github.com/acme/repo');

    expect(cleanup).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledOnce();
    expect(markers.size).toBe(0);
  });
});
