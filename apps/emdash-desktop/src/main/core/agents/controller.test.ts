import type { DependencyState } from '@emdash/core/deps/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensureAgentDependenciesProbed: vi.fn(),
  getDependencyManager: vi.fn(),
  enrichHostDependency: vi.fn((_id: string, hostDep: unknown) => hostDep),
  refreshLatestVersion: vi.fn(),
  setSelection: vi.fn(),
  clearResolvedPathCache: vi.fn(),
  getItemWithMeta: vi.fn(),
  getItem: vi.fn(),
  updateItem: vi.fn(),
  buildAgentPayloads: vi.fn(),
  buildAgentPayload: vi.fn(),
  buildAgentMetadataList: vi.fn(),
  toAgentInstallationStatus: vi.fn(
    (id: string, connectionId: string | undefined, state: DependencyState) => ({
      id,
      connectionId,
      status: state.status,
      version: state.version,
      latestVersion: null,
      updateAvailable: false,
      command: state.path,
      installations: [],
      used: { kind: 'auto' },
      usedId: 'auto',
      installOptions: [],
    })
  ),
}));

vi.mock('../dependencies/dependency-managers', () => ({
  ensureAgentDependenciesProbed: mocks.ensureAgentDependenciesProbed,
  getDependencyManager: mocks.getDependencyManager,
}));

vi.mock('../dependencies/agent-update-service', () => ({
  agentUpdateService: {
    enrichHostDependency: mocks.enrichHostDependency,
    refreshLatestVersion: mocks.refreshLatestVersion,
  },
}));

vi.mock('../dependencies/host-dependency-store', () => ({
  hostDependencyStore: {
    setSelection: mocks.setSelection,
  },
}));

vi.mock('../conversations/impl/resolve-agent-executable', () => ({
  clearResolvedPathCache: mocks.clearResolvedPathCache,
}));

vi.mock('../settings/provider-settings-service', () => ({
  providerOverrideSettings: {
    getItemWithMeta: mocks.getItemWithMeta,
    getItem: mocks.getItem,
    updateItem: mocks.updateItem,
  },
}));

vi.mock('./agent-payload-builder', () => ({
  buildAgentPayloads: mocks.buildAgentPayloads,
  buildAgentPayload: mocks.buildAgentPayload,
  buildAgentMetadataList: mocks.buildAgentMetadataList,
  toAgentInstallationStatus: mocks.toAgentInstallationStatus,
}));

const { agentsController } = await import('./controller');

function makeState(values: Partial<DependencyState>): DependencyState {
  return {
    id: values.id ?? 'claude',
    category: values.category ?? 'agent',
    status: values.status ?? 'available',
    version: values.version ?? null,
    path: values.path ?? null,
    checkedAt: values.checkedAt ?? 1,
    error: values.error,
  };
}

function makeManager(states: DependencyState[]) {
  return {
    getAll: vi.fn(() => new Map(states.map((state) => [state.id, state]))),
    get: vi.fn((id: string) => states.find((state) => state.id === id)),
    getHostDependency: vi.fn(() => undefined),
    platform: 'linux',
  };
}

describe('agentsController agent status manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('probes remote agent dependencies before listing installation status', async () => {
    const manager = makeManager([
      makeState({ id: 'claude', path: '/usr/local/bin/claude' }),
      makeState({ id: 'git', category: 'core', path: '/usr/bin/git' }),
    ]);
    mocks.getDependencyManager.mockResolvedValue(manager);

    const result = await agentsController.listAgentInstallationStatus('ssh-1');

    expect(mocks.ensureAgentDependenciesProbed).toHaveBeenCalledWith(manager, 'ssh-1');
    expect(mocks.getDependencyManager).toHaveBeenCalledWith('ssh-1');
    expect(mocks.getDependencyManager.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.ensureAgentDependenciesProbed.mock.invocationCallOrder[0]
    );
    expect(mocks.ensureAgentDependenciesProbed.mock.invocationCallOrder[0]).toBeLessThan(
      manager.getAll.mock.invocationCallOrder[0]
    );
    expect(manager.getAll).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      expect.objectContaining({
        id: 'claude',
        connectionId: 'ssh-1',
        status: 'available',
        command: '/usr/local/bin/claude',
      }),
    ]);
  });

  it('probes remote agent dependencies before reading a single installation status', async () => {
    const manager = makeManager([makeState({ id: 'codex', path: '/usr/local/bin/codex' })]);
    mocks.getDependencyManager.mockResolvedValue(manager);

    const result = await agentsController.getAgentInstallationStatus('codex', 'ssh-1');

    expect(mocks.ensureAgentDependenciesProbed).toHaveBeenCalledWith(manager, 'ssh-1');
    expect(mocks.getDependencyManager).toHaveBeenCalledWith('ssh-1');
    expect(mocks.getDependencyManager.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.ensureAgentDependenciesProbed.mock.invocationCallOrder[0]
    );
    expect(mocks.ensureAgentDependenciesProbed.mock.invocationCallOrder[0]).toBeLessThan(
      manager.get.mock.invocationCallOrder[0]
    );
    expect(manager.get).toHaveBeenCalledWith('codex');
    expect(result).toEqual(
      expect.objectContaining({
        id: 'codex',
        connectionId: 'ssh-1',
        status: 'available',
        command: '/usr/local/bin/codex',
      })
    );
  });
});
