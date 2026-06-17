import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@main/core/ssh/lifecycle/production-ssh-connection-manager', () => ({
  sshConnectionManager: {
    getProxy: vi.fn(),
    connect: vi.fn(),
  },
}));

vi.mock('@main/core/dependencies/registry', () => ({
  DEPENDENCIES: [],
  getDependencyDescriptor: vi.fn().mockReturnValue(undefined),
}));

vi.mock('@main/core/dependencies/host-dependency-store', () => ({
  hostDependencyStore: { getSelection: vi.fn().mockResolvedValue(null) },
}));

vi.mock('@main/core/conversations/impl/resolve-agent-executable', () => ({
  clearResolvedPathCache: vi.fn(),
}));

vi.mock('@main/core/dependencies/agent-update-service', () => ({
  agentUpdateService: { attach: vi.fn() },
}));

vi.mock('@main/core/dependencies/install-runner', () => ({
  createLocalInstallCommandRunner: vi.fn().mockReturnValue(vi.fn()),
  createSshInstallCommandRunner: vi.fn().mockReturnValue(vi.fn()),
}));

vi.mock('@main/core/settings/settings-service', () => ({
  appSettingsService: { get: vi.fn().mockResolvedValue({ defaultShell: null }) },
}));

vi.mock('@main/core/terminal-shell/resolver', () => ({
  resolveLocalAutomationShellWithSystemFallback: vi.fn().mockResolvedValue('/bin/sh'),
}));

vi.mock('@main/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@main/core/execution-context/ssh-execution-context', () => ({
  SshExecutionContext: class {
    exec = vi.fn().mockResolvedValue({ stdout: 'Linux', stderr: '', exitCode: 0 });
  },
}));

vi.mock('@main/core/execution-context/local-execution-context', () => ({
  LocalExecutionContext: class {},
}));

describe('getDependencyManager — getProxy preference', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('uses an already-pooled proxy without calling connect()', async () => {
    const fakeProxy = { exec: vi.fn().mockResolvedValue({ stdout: 'Linux', stderr: '' }) };

    const { sshConnectionManager } =
      await import('@main/core/ssh/lifecycle/production-ssh-connection-manager');
    const mockManager = sshConnectionManager as unknown as {
      getProxy: ReturnType<typeof vi.fn>;
      connect: ReturnType<typeof vi.fn>;
    };
    mockManager.getProxy.mockReturnValue(fakeProxy);
    mockManager.connect.mockRejectedValue(new Error('should not be called'));

    const { getDependencyManager } = await import('@main/core/dependencies/dependency-managers');

    const mgr = await getDependencyManager('task:abc');

    // Verify the returned manager has the expected HostDependencyManager shape.
    expect(typeof mgr.probe).toBe('function');
    expect(mockManager.getProxy).toHaveBeenCalledWith('task:abc');
    expect(mockManager.connect).not.toHaveBeenCalled();
  });

  it('falls back to connect() when no proxy is pooled', async () => {
    const fakeProxy = { exec: vi.fn().mockResolvedValue({ stdout: 'Linux', stderr: '' }) };

    const { sshConnectionManager } =
      await import('@main/core/ssh/lifecycle/production-ssh-connection-manager');
    const mockManager = sshConnectionManager as unknown as {
      getProxy: ReturnType<typeof vi.fn>;
      connect: ReturnType<typeof vi.fn>;
    };
    mockManager.getProxy.mockReturnValue(undefined);
    mockManager.connect.mockResolvedValue(fakeProxy);

    const { getDependencyManager } = await import('@main/core/dependencies/dependency-managers');

    const mgr = await getDependencyManager('persisted:xyz');

    // Verify the returned manager has the expected HostDependencyManager shape.
    expect(typeof mgr.probe).toBe('function');
    expect(mockManager.getProxy).toHaveBeenCalledWith('persisted:xyz');
    expect(mockManager.connect).toHaveBeenCalledWith('persisted:xyz');
  });
});
