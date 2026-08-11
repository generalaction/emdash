import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import type { AutomationRun } from '@emdash/core/runtimes/automations/api';
import { ok } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AutomationsService } from '@core/features/automations/api/node/automations-service';
import type { Automation } from '@core/primitives/automations/api';

const mocks = vi.hoisted(() => ({
  buildAutomationDeployment: vi.fn(),
  client: vi.fn(),
  deploy: vi.fn(),
  getAutomation: vi.fn(),
  getAutomationRuntimeAvailability: vi.fn(),
  getProjectById: vi.fn(),
  insertAutomation: vi.fn(),
  listAutomations: vi.fn(),
  listTombstonedAutomations: vi.fn(async () => []),
  logWarn: vi.fn(),
  onEvent: undefined as ((event: { run: AutomationRun }) => void) | undefined,
  projectExists: vi.fn(),
  remove: vi.fn(),
  resolveAutomationRuntimeClient: vi.fn(),
  replaceAutomation: vi.fn(),
  setAutomationRevision: vi.fn(),
  unsubscribe: vi.fn(),
  upsertRunProjection: vi.fn(),
}));

vi.mock('@core/primitives/automations/api', () => ({
  assertValidCronTrigger: vi.fn(),
  getLocalTimeZone: () => 'UTC',
}));

vi.mock('@emdash/shared/logger', () => ({
  log: {
    error: vi.fn(),
    warn: mocks.logWarn,
  },
}));

vi.mock('./deployment-builder', () => ({
  buildAutomationDeployment: mocks.buildAutomationDeployment,
}));

vi.mock('./repo', () => ({
  getAutomation: mocks.getAutomation,
  insertAutomation: mocks.insertAutomation,
  listAutomations: mocks.listAutomations,
  listTombstonedAutomations: mocks.listTombstonedAutomations,
  projectExists: mocks.projectExists,
  replaceAutomation: mocks.replaceAutomation,
  setAutomationRevision: mocks.setAutomationRevision,
}));

vi.mock('@core/features/automations/api/node/run-projection', () => ({
  upsertRunProjection: mocks.upsertRunProjection,
}));

vi.mock('./runtime-client-resolver', () => ({
  getAutomationRuntimeAvailability: mocks.getAutomationRuntimeAvailability,
  resolveAutomationRuntimeClient: mocks.resolveAutomationRuntimeClient,
}));

function automationFixture(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 'automation-1',
    projectId: 'project-1',
    name: 'Review changes',
    triggerConfig: { expr: '0 9 * * *', tz: 'UTC' },
    conversationConfig: {
      prompt: 'Review changes',
      provider: 'claude',
      autoApprove: false,
      type: 'acp',
    },
    taskConfig: {
      version: '1',
      taskConfig: { version: '1', name: 'Review changes' },
      workspaceConfig: {
        version: '2',
        git: { kind: 'none' },
        workspace: { kind: 'repository-instance', workspaceId: 'workspace-1' },
      },
    },
    enabled: true,
    revision: 1,
    createdAt: 10,
    updatedAt: 20,
    ...overrides,
  };
}

function createService(): AutomationsService {
  return new AutomationsService({
    buildDeployment: mocks.buildAutomationDeployment,
    db: {} as never,
    runtime: {
      runtimes: { client: mocks.client },
      getProjectById: mocks.getProjectById,
    },
  });
}

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
  mocks.onEvent = undefined;
  mocks.buildAutomationDeployment.mockImplementation((automation: Automation) =>
    ok({
      automationId: automation.id,
      revision: automation.revision,
    })
  );
  mocks.deploy.mockImplementation(async (deployment: { revision: number }) => ({
    success: true,
    data: { deployment, deployedAt: 100 },
  }));
  mocks.remove.mockResolvedValue({ success: true, data: undefined });
  mocks.projectExists.mockResolvedValue(true);
  mocks.getProjectById.mockResolvedValue({ id: 'project-1', type: 'local' });
  mocks.getAutomationRuntimeAvailability.mockResolvedValue({ available: true });
  mocks.setAutomationRevision.mockResolvedValue(true);
  mocks.listAutomations.mockResolvedValue([]);
  mocks.getAutomation.mockResolvedValue(automationFixture());
  mocks.upsertRunProjection.mockResolvedValue(undefined);
  const runtimeClient = {
    automations: {
      deploy: mocks.deploy,
      remove: mocks.remove,
      runEvents: {
        subscribe: async (
          _key: unknown,
          handlers: { onEvent: (event: { run: AutomationRun }) => void }
        ) => {
          mocks.onEvent = handlers.onEvent;
          return mocks.unsubscribe;
        },
      },
    },
  };
  mocks.client.mockResolvedValue(ok(runtimeClient));
  mocks.resolveAutomationRuntimeClient.mockResolvedValue(runtimeClient);
});

describe('AutomationsService definition synchronization', () => {
  it('removes a deployed definition when the desktop insert fails', async () => {
    const service = createService();
    mocks.insertAutomation.mockRejectedValue(new Error('insert failed'));

    const result = await service.create({
      projectId: 'project-1',
      name: 'Review changes',
      triggerConfig: { expr: '0 9 * * *', tz: 'UTC' },
      conversationConfig: {
        prompt: 'Review changes',
        provider: 'claude',
        autoApprove: false,
        type: 'acp',
      },
      taskConfig: automationFixture().taskConfig!,
    });

    expect(result).toEqual({
      success: false,
      error: { type: 'runtime-unavailable', message: 'insert failed' },
    });

    expect(mocks.deploy).toHaveBeenCalledOnce();
    expect(mocks.remove).toHaveBeenCalledWith({ automationId: expect.any(String) });
  });

  it('restores the previous deployment with a newer revision after an update conflict', async () => {
    const service = createService();
    const existing = automationFixture();
    mocks.getAutomation.mockResolvedValue(existing);
    mocks.replaceAutomation.mockResolvedValue(null);

    const result = await service.update(existing.id, { name: 'Updated name' });

    expect(result).toEqual({
      success: false,
      error: {
        type: 'automation-conflict',
        automationId: existing.id,
        message: 'This automation changed while it was being saved. Try again.',
      },
    });

    expect(mocks.deploy.mock.calls.map(([deployment]) => deployment.revision)).toEqual([2, 3]);
    expect(mocks.setAutomationRevision).toHaveBeenCalledWith(expect.anything(), existing.id, 3);
  });

  it('publishes deletion hooks for callers that tombstoned an automation', () => {
    const service = createService();
    const hook = vi.fn();
    service.on('automation:deleted', hook);

    service.notifyDeleted('automation-1');

    expect(hook).toHaveBeenCalledWith('automation-1');
  });
});

describe('AutomationsService run projection', () => {
  it('reconciles only definitions for the runtime host supplied at startup', async () => {
    const service = createService();
    const localAutomation = automationFixture({ id: 'local-automation' });
    const remoteAutomation = automationFixture({
      id: 'remote-automation',
      projectId: 'remote-project',
    });
    mocks.listAutomations.mockResolvedValue([localAutomation, remoteAutomation]);
    mocks.getProjectById.mockImplementation(async (projectId: string) =>
      projectId === 'remote-project'
        ? { id: projectId, type: 'ssh', connectionId: 'ssh-1' }
        : { id: projectId, type: 'local' }
    );

    await service.initialize();

    expect(mocks.resolveAutomationRuntimeClient).toHaveBeenCalledTimes(1);
    expect(mocks.resolveAutomationRuntimeClient).toHaveBeenCalledWith(expect.anything());
    expect(mocks.buildAutomationDeployment).toHaveBeenCalledOnce();
    expect(mocks.buildAutomationDeployment).toHaveBeenCalledWith(localAutomation);
    expect(mocks.deploy).toHaveBeenCalledOnce();
  });

  it('projects runtime events and logs projection failures without stopping telemetry hooks', async () => {
    const service = createService();
    const telemetryHook = vi.fn();
    service.on('run:step-completed', telemetryHook);
    await service.initialize();
    const run = runFixture();
    mocks.upsertRunProjection.mockRejectedValue(new Error('database unavailable'));

    expect(() => mocks.onEvent?.({ run })).not.toThrow();

    await vi.waitFor(() => {
      expect(mocks.upsertRunProjection).toHaveBeenCalledWith(expect.anything(), run);
      expect(telemetryHook).toHaveBeenCalledWith(run);
      expect(mocks.logWarn).toHaveBeenCalledWith('Failed to update the automation run projection', {
        automationId: 'automation-1',
        runId: 'run-1',
        error: 'database unavailable',
      });
    });

    service.stop();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });

  it('ignores runtime events for tombstoned automations', async () => {
    const service = createService();
    const telemetryHook = vi.fn();
    service.on('run:step-completed', telemetryHook);
    await service.initialize();
    mocks.getAutomation.mockResolvedValue(null);

    mocks.onEvent?.({ run: runFixture() });

    await vi.waitFor(() => {
      expect(mocks.getAutomation).toHaveBeenCalledWith(expect.anything(), 'automation-1');
    });
    expect(mocks.upsertRunProjection).not.toHaveBeenCalled();
    expect(telemetryHook).not.toHaveBeenCalled();
  });
});
