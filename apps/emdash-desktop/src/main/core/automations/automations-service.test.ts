import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import type { AutomationRun } from '@emdash/core/runtimes/automations/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Automation } from '@core/primitives/automations/api';
import { AutomationsService } from './automations-service';

const mocks = vi.hoisted(() => ({
  buildAutomationDeployment: vi.fn(),
  deleteAutomationDefinition: vi.fn(),
  deploy: vi.fn(),
  getAutomation: vi.fn(),
  getAutomationRuntimeAvailability: vi.fn(),
  insertAutomation: vi.fn(),
  listAutomations: vi.fn(),
  logWarn: vi.fn(),
  onEvent: undefined as ((event: { run: AutomationRun }) => void) | undefined,
  projectExists: vi.fn(),
  remove: vi.fn(),
  replaceAutomation: vi.fn(),
  resolveAutomationRuntime: vi.fn(),
  resolveLocalAutomationRuntime: vi.fn(),
  setAutomationRevision: vi.fn(),
  unsubscribe: vi.fn(),
  upsertRunProjection: vi.fn(),
}));

vi.mock('@core/primitives/automations/api', () => ({
  assertValidCronTrigger: vi.fn(),
  getLocalTimeZone: () => 'UTC',
}));

vi.mock('@main/lib/logger', () => ({
  log: {
    error: vi.fn(),
    warn: mocks.logWarn,
  },
}));

vi.mock('./deployment-builder', () => ({
  buildAutomationDeployment: mocks.buildAutomationDeployment,
}));

vi.mock('./repo', () => ({
  deleteAutomationDefinition: mocks.deleteAutomationDefinition,
  getAutomation: mocks.getAutomation,
  insertAutomation: mocks.insertAutomation,
  listAutomations: mocks.listAutomations,
  projectExists: mocks.projectExists,
  replaceAutomation: mocks.replaceAutomation,
  setAutomationRevision: mocks.setAutomationRevision,
}));

vi.mock('./run-projection', () => ({
  upsertRunProjection: mocks.upsertRunProjection,
}));

vi.mock('./runtime-client-resolver', () => ({
  getAutomationRuntimeAvailability: mocks.getAutomationRuntimeAvailability,
  resolveAutomationRuntime: mocks.resolveAutomationRuntime,
  resolveLocalAutomationRuntime: mocks.resolveLocalAutomationRuntime,
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
  mocks.buildAutomationDeployment.mockImplementation((automation: Automation) => ({
    automationId: automation.id,
    revision: automation.revision,
  }));
  mocks.deploy.mockImplementation(async (deployment: { revision: number }) => ({
    success: true,
    data: { deployment, deployedAt: 100 },
  }));
  mocks.remove.mockResolvedValue({ success: true, data: undefined });
  mocks.projectExists.mockResolvedValue(true);
  mocks.getAutomationRuntimeAvailability.mockResolvedValue({ available: true });
  mocks.setAutomationRevision.mockResolvedValue(true);
  mocks.listAutomations.mockResolvedValue([]);
  mocks.upsertRunProjection.mockResolvedValue(undefined);
  const runtimeTarget = {
    key: 'local',
    client: { deploy: mocks.deploy, remove: mocks.remove },
  };
  mocks.resolveAutomationRuntime.mockResolvedValue(runtimeTarget);
  mocks.resolveLocalAutomationRuntime.mockResolvedValue({
    ...runtimeTarget,
    client: {
      ...runtimeTarget.client,
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
  });
});

describe('AutomationsService definition synchronization', () => {
  it('removes a deployed definition when the desktop insert fails', async () => {
    const service = new AutomationsService();
    mocks.insertAutomation.mockRejectedValue(new Error('insert failed'));

    await expect(
      service.create({
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
      })
    ).rejects.toThrow('insert failed');

    expect(mocks.deploy).toHaveBeenCalledOnce();
    expect(mocks.remove).toHaveBeenCalledWith({ automationId: expect.any(String) });
  });

  it('restores the previous deployment with a newer revision after an update conflict', async () => {
    const service = new AutomationsService();
    const existing = automationFixture();
    mocks.getAutomation.mockResolvedValue(existing);
    mocks.replaceAutomation.mockResolvedValue(null);

    await expect(service.update(existing.id, { name: 'Updated name' })).rejects.toThrow(
      'automation_conflict'
    );

    expect(mocks.deploy.mock.calls.map(([deployment]) => deployment.revision)).toEqual([2, 3]);
    expect(mocks.setAutomationRevision).toHaveBeenCalledWith(existing.id, 3);
  });

  it('restores a removed deployment when the desktop delete fails', async () => {
    const service = new AutomationsService();
    const existing = automationFixture();
    mocks.getAutomation.mockResolvedValue(existing);
    mocks.deleteAutomationDefinition.mockRejectedValue(new Error('delete failed'));

    await expect(service.delete(existing.id)).rejects.toThrow('delete failed');

    expect(mocks.remove).toHaveBeenCalledWith({ automationId: existing.id });
    expect(mocks.deploy.mock.calls.map(([deployment]) => deployment.revision)).toEqual([3]);
    expect(mocks.setAutomationRevision).toHaveBeenCalledWith(existing.id, 3);
  });
});

describe('AutomationsService run projection', () => {
  it('projects runtime events and logs projection failures without stopping telemetry hooks', async () => {
    const service = new AutomationsService();
    const telemetryHook = vi.fn();
    service.on('run:step-completed', telemetryHook);
    await service.initialize();
    const run = runFixture();
    mocks.upsertRunProjection.mockRejectedValue(new Error('database unavailable'));

    expect(() => mocks.onEvent?.({ run })).not.toThrow();

    expect(mocks.upsertRunProjection).toHaveBeenCalledWith(run);
    expect(telemetryHook).toHaveBeenCalledWith(run);
    await vi.waitFor(() => {
      expect(mocks.logWarn).toHaveBeenCalledWith('Failed to update the automation run projection', {
        automationId: 'automation-1',
        runId: 'run-1',
        error: 'database unavailable',
      });
    });

    service.stop();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });
});
