import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  disposeProjects: vi.fn(async () => {}),
  listProjectIds: vi.fn(() => ['proj-1']),
  listActiveSessions: vi.fn(() => []),
  stopResourceSampler: vi.fn(),
  reconcileResourceSampler: vi.fn(),
}));

vi.mock('@main/core/projects/project-manager', () => ({
  projectManager: {
    listProjectIds: mocks.listProjectIds,
    dispose: mocks.disposeProjects,
  },
}));

vi.mock('@main/core/pty/pty-session-registry', () => ({
  ptySessionRegistry: {
    listActiveSessions: mocks.listActiveSessions,
  },
}));

vi.mock('@main/core/resource-monitor/resource-sampler', () => ({
  stopResourceSampler: mocks.stopResourceSampler,
  reconcileResourceSampler: mocks.reconcileResourceSampler,
}));

vi.mock('@main/lib/telemetry', () => ({
  telemetryService: {
    capture: vi.fn(),
    dispose: vi.fn(async () => {}),
  },
}));

vi.mock('@main/core/agent-hooks/agent-hook-service', () => ({
  agentHookService: { dispose: vi.fn() },
}));

vi.mock('@main/core/updates/update-service', () => ({
  updateService: { dispose: vi.fn() },
}));

vi.mock('@main/core/pull-requests/pr-sync-scheduler', () => ({
  prSyncScheduler: { dispose: vi.fn() },
}));

vi.mock('@main/core/git/git-watcher-registry', () => ({
  gitWatcherRegistry: { dispose: vi.fn(async () => {}) },
}));

import { runBackgroundShutdown } from './background-shutdown';

describe('runBackgroundShutdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('simulates shutdown without disposing global services', async () => {
    const result = await runBackgroundShutdown('simulate');

    expect(result.projectIds).toEqual(['proj-1']);
    expect(mocks.disposeProjects).toHaveBeenCalledTimes(1);
    expect(mocks.stopResourceSampler).toHaveBeenCalledTimes(1);
    expect(mocks.reconcileResourceSampler).toHaveBeenCalledTimes(1);
  });
});
