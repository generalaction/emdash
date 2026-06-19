import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const instances: Array<{
    get: ReturnType<typeof vi.fn>;
    probeCategory: ReturnType<typeof vi.fn>;
    onExecutableInvalidated: { subscribe: ReturnType<typeof vi.fn> };
    setAgentStates(): void;
  }> = [];

  class FakeHostDependencyManager {
    private readonly states = new Map<string, { id: string; category: string }>();
    readonly get = vi.fn((id: string) => this.states.get(id));
    readonly probeCategory = vi.fn(async (category: string) => {
      if (category === 'agent') {
        this.states.set('claude', { id: 'claude', category: 'agent' });
        this.states.set('codex', { id: 'codex', category: 'agent' });
      }
    });
    readonly onExecutableInvalidated = { subscribe: vi.fn() };

    setAgentStates(): void {
      this.states.set('claude', { id: 'claude', category: 'agent' });
      this.states.set('codex', { id: 'codex', category: 'agent' });
    }

    constructor() {
      instances.push(this);
    }
  }

  return {
    instances,
    FakeHostDependencyManager,
    attach: vi.fn(),
    clearResolvedPathCache: vi.fn(),
    connect: vi.fn(),
    getSelection: vi.fn(),
    createLocalInstallCommandRunner: vi.fn(() => vi.fn()),
    createSshInstallCommandRunner: vi.fn(() => vi.fn()),
  };
});

vi.mock('@emdash/core/deps/runtime', () => ({
  HostDependencyManager: mocks.FakeHostDependencyManager,
}));

vi.mock('@main/core/conversations/impl/resolve-agent-executable', () => ({
  clearResolvedPathCache: mocks.clearResolvedPathCache,
}));

vi.mock('@main/core/execution-context/local-execution-context', () => ({
  LocalExecutionContext: class {},
}));

vi.mock('@main/core/execution-context/ssh-execution-context', () => ({
  SshExecutionContext: class {
    async exec() {
      return { stdout: 'Linux\n', stderr: '' };
    }
  },
}));

vi.mock('@main/core/settings/settings-service', () => ({
  appSettingsService: {
    get: vi.fn(async () => ({ defaultShell: null })),
  },
}));

vi.mock('@main/core/ssh/lifecycle/production-ssh-connection-manager', () => ({
  sshConnectionManager: {
    connect: mocks.connect,
  },
}));

vi.mock('@main/core/terminal-shell/resolver', () => ({
  resolveLocalAutomationShellWithSystemFallback: vi.fn(async () => ({ shell: '/bin/sh' })),
}));

vi.mock('@main/lib/logger', () => ({
  log: {
    warn: vi.fn(),
  },
}));

vi.mock('./agent-update-service', () => ({
  agentUpdateService: {
    attach: mocks.attach,
  },
}));

vi.mock('./host-dependency-store', () => ({
  hostDependencyStore: {
    getSelection: mocks.getSelection,
  },
}));

vi.mock('./install-runner', () => ({
  createLocalInstallCommandRunner: mocks.createLocalInstallCommandRunner,
  createSshInstallCommandRunner: mocks.createSshInstallCommandRunner,
}));

vi.mock('./registry', () => ({
  DEPENDENCIES: [
    { id: 'claude', category: 'agent' },
    { id: 'codex', category: 'agent' },
    { id: 'git', category: 'core' },
  ],
  AGENT_DEPENDENCIES: [
    { id: 'claude', category: 'agent' },
    { id: 'codex', category: 'agent' },
  ],
  getDependencyDescriptor: vi.fn(),
}));

describe('ensureAgentDependenciesProbed', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.instances.length = 0;
  });

  it('deduplicates concurrent first-use probes for the same host', async () => {
    const { ensureAgentDependenciesProbed, getDependencyManager } =
      await import('./dependency-managers');
    const manager = await getDependencyManager();
    const fakeManager = mocks.instances[0]!;
    let resolveProbe: (() => void) | undefined;
    const probe = new Promise<void>((resolve) => {
      resolveProbe = resolve;
    });
    fakeManager.probeCategory.mockReturnValue(probe);

    const first = ensureAgentDependenciesProbed(manager, undefined);
    const second = ensureAgentDependenciesProbed(manager, undefined);
    await Promise.resolve();
    await Promise.resolve();

    expect(fakeManager.probeCategory).toHaveBeenCalledTimes(1);
    expect(fakeManager.probeCategory).toHaveBeenCalledWith('agent', { refreshShellEnv: true });

    if (!resolveProbe) throw new Error('Probe did not start');
    fakeManager.setAgentStates();
    resolveProbe();
    await Promise.all([first, second]);
  });

  it('does not probe again after the first probe completes', async () => {
    const { ensureAgentDependenciesProbed, getDependencyManager } =
      await import('./dependency-managers');
    const manager = await getDependencyManager();
    const fakeManager = mocks.instances[0]!;

    await ensureAgentDependenciesProbed(manager, undefined);
    await ensureAgentDependenciesProbed(manager, undefined);

    expect(fakeManager.probeCategory).toHaveBeenCalledTimes(1);
  });

  it('keeps manager access separate from explicit agent probing', async () => {
    const { ensureAgentDependenciesProbed, getDependencyManager } =
      await import('./dependency-managers');
    const localManager = mocks.instances[0]!;

    await expect(getDependencyManager()).resolves.toBe(localManager);
    expect(localManager.probeCategory).not.toHaveBeenCalled();

    mocks.connect.mockResolvedValue({});
    const remoteManager = await getDependencyManager('ssh-1');
    expect(remoteManager.probeCategory).not.toHaveBeenCalled();

    await ensureAgentDependenciesProbed(remoteManager, 'ssh-1');

    expect(remoteManager.probeCategory).toHaveBeenCalledWith('agent', { refreshShellEnv: true });
    await expect(getDependencyManager('ssh-1')).resolves.toBe(remoteManager);
  });
});
