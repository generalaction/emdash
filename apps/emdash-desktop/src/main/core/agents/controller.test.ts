import { beforeEach, describe, expect, it, vi } from 'vitest';
import { agentsController } from './controller';

function createManagerMock() {
  return {
    platform: 'macos' as const,
    getAll: vi.fn(() => new Map()),
    getHostDependency: vi.fn(),
    probeCategory: vi.fn(async () => {}),
  };
}

const managerMocks = vi.hoisted(() => ({
  current: {
    platform: 'macos' as const,
    getAll: vi.fn(() => new Map()),
    getHostDependency: vi.fn(),
    probeCategory: vi.fn(async () => {}),
  },
}));

vi.mock('../dependencies/dependency-managers', () => ({
  getDependencyManager: vi.fn(async () => managerMocks.current),
}));

vi.mock('../dependencies/agent-update-service', () => ({
  agentUpdateService: {
    enrichHostDependency: vi.fn((_id, hostDep) => hostDep),
  },
}));

vi.mock('../dependencies/host-dependency-store', () => ({
  hostDependencyStore: {
    setSelection: vi.fn(),
  },
}));

vi.mock('../settings/provider-settings-service', () => ({
  providerOverrideSettings: {
    getItemWithMeta: vi.fn(),
    updateItem: vi.fn(),
  },
}));

vi.mock('../conversations/impl/resolve-agent-executable', () => ({
  clearResolvedPathCache: vi.fn(),
}));

describe('agentsController.listAgentInstallationStatus', () => {
  beforeEach(() => {
    managerMocks.current = createManagerMock();
    vi.clearAllMocks();
  });

  it('does not repeat category probes after an empty agent probe result', async () => {
    await agentsController.listAgentInstallationStatus();
    await agentsController.listAgentInstallationStatus();

    expect(managerMocks.current.probeCategory).toHaveBeenCalledTimes(1);
    expect(managerMocks.current.probeCategory).toHaveBeenCalledWith('agent');
  });

  it('deduplicates concurrent cold category probes', async () => {
    let resolveProbe: (() => void) | undefined;
    managerMocks.current.probeCategory.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveProbe = resolve;
      })
    );

    const first = agentsController.listAgentInstallationStatus();
    const second = agentsController.listAgentInstallationStatus();
    await Promise.resolve();

    expect(managerMocks.current.probeCategory).toHaveBeenCalledTimes(1);

    resolveProbe?.();
    await Promise.all([first, second]);

    expect(managerMocks.current.probeCategory).toHaveBeenCalledTimes(1);
  });
});
