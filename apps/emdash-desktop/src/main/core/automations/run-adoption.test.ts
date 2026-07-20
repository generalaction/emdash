import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import type { AutomationRun } from '@emdash/core/runtimes/automations/api';
import { err, ok } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adoptRun } from './run-adoption';

const mocks = vi.hoisted(() => ({
  dbSelect: vi.fn(),
  getAutomation: vi.fn(),
  getProjectById: vi.fn(),
  getRun: vi.fn(),
  isAutomationRunAdoptable: vi.fn(),
  resolveAutomationRuntime: vi.fn(),
  upsertRunProjection: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: { select: mocks.dbSelect },
}));

vi.mock('@core/primitives/automations/api', async () => ({
  ...(await import('@core/primitives/automations/api/config')),
  isAutomationRunAdoptable: mocks.isAutomationRunAdoptable,
}));

vi.mock('@main/core/projects/operations/getProjects', () => ({
  getProjectById: mocks.getProjectById,
}));

vi.mock('./repo', () => ({
  getAutomation: mocks.getAutomation,
}));

vi.mock('./runtime-client-resolver', () => ({
  resolveAutomationRuntime: mocks.resolveAutomationRuntime,
}));

vi.mock('./run-projection', () => ({
  upsertRunProjection: mocks.upsertRunProjection,
}));

function runFixture(): AutomationRun {
  return {
    id: 'run-1',
    seq: 1,
    automationId: 'automation-1',
    status: 'provisioning_workspace',
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
    generatedName: 'automation-1',
    scheduledAt: null,
    deadlineAt: null,
    startedAt: null,
    finishedAt: null,
    workspace: null,
    branchName: null,
    conversationId: null,
    sessionId: null,
    error: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAutomation.mockResolvedValue({ id: 'automation-1', projectId: 'project-1' });
  mocks.getProjectById.mockResolvedValue(null);
  mocks.isAutomationRunAdoptable.mockReturnValue(false);
  mocks.resolveAutomationRuntime.mockResolvedValue({
    key: 'local',
    client: { getRun: mocks.getRun },
  });
  mocks.upsertRunProjection.mockResolvedValue(undefined);
  mocks.dbSelect.mockReturnValue({
    from: () => ({
      where: () => ({
        limit: async () => [],
      }),
    }),
  });
});

describe('automation run adoption lookup', () => {
  it('uses the scoped point lookup', async () => {
    mocks.getRun.mockResolvedValue(ok({ run: runFixture() }));

    await expect(adoptRun('automation-1', 'run-1')).rejects.toThrow(
      'automation_run_workspace_not_ready'
    );
    expect(mocks.getRun).toHaveBeenCalledOnce();
    expect(mocks.getRun).toHaveBeenCalledWith({
      automationId: 'automation-1',
      runId: 'run-1',
    });
  });

  it('reports a missing runtime run', async () => {
    mocks.getRun.mockResolvedValue(ok({ run: null }));

    await expect(adoptRun('automation-1', 'missing-run')).rejects.toThrow(
      'automation_run_not_found'
    );
    expect(mocks.dbSelect).not.toHaveBeenCalled();
  });

  it('propagates runtime read failures', async () => {
    mocks.getRun.mockResolvedValue(
      err({ type: 'runtime-unavailable', message: 'Automation runtime is unavailable' })
    );

    await expect(adoptRun('automation-1', 'unavailable-run')).rejects.toThrow(
      'Automation runtime is unavailable'
    );
    expect(mocks.dbSelect).not.toHaveBeenCalled();
  });

  it('writes the projection before continuing task adoption', async () => {
    const run = runFixture();
    mocks.getRun.mockResolvedValue(ok({ run }));
    mocks.isAutomationRunAdoptable.mockReturnValue(true);

    await expect(adoptRun('automation-1', 'run-1')).rejects.toThrow('project_not_found');

    expect(mocks.upsertRunProjection).toHaveBeenCalledOnce();
    expect(mocks.upsertRunProjection).toHaveBeenCalledWith(run);
    expect(mocks.upsertRunProjection.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getProjectById.mock.invocationCallOrder[0]!
    );
  });

  it('does not continue task adoption when the projection write fails', async () => {
    mocks.getRun.mockResolvedValue(ok({ run: runFixture() }));
    mocks.isAutomationRunAdoptable.mockReturnValue(true);
    mocks.upsertRunProjection.mockRejectedValue(new Error('projection_write_failed'));

    await expect(adoptRun('automation-1', 'run-1')).rejects.toThrow('projection_write_failed');

    expect(mocks.getProjectById).not.toHaveBeenCalled();
  });
});
