import path from 'node:path';
import type { ITrustBehavior } from '@emdash/core/services/agent-plugins/api/plugins';
import type { AgentProviderId } from '@emdash/plugins/agents';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceTrustService } from './workspace-trust';

const mockWarn = vi.hoisted(() => vi.fn());

vi.mock('@main/lib/logger', () => ({
  log: {
    warn: mockWarn,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@main/bootstrap/core/service-instances', () => ({
  getAppSettingsService: () => ({ get: vi.fn() }),
}));

vi.mock('./plugin-registry', () => ({
  getPlugin: vi.fn(() => ({ behavior: {} })),
}));

describe('WorkspaceTrustService', () => {
  it('skips when auto-trust is disabled', async () => {
    const trustWorkspace = vi.fn();
    const service = makeService({
      getTaskSettings: vi.fn(async () => ({ autoTrustWorktrees: false })),
      getTrustBehavior: vi.fn(() => ({ trustWorkspace })),
    });

    await service.maybeAutoTrust({
      providerId: 'claude',
      workspacePath: '/tmp/worktree',
      host: { kind: 'local', homedir: '/home/local-user' },
    });

    expect(trustWorkspace).not.toHaveBeenCalled();
  });

  it('trusts when forced even if auto-trust is disabled', async () => {
    const trustWorkspace = vi.fn();
    const getTaskSettings = vi.fn(async () => ({ autoTrustWorktrees: false }));
    const service = makeService({
      getTaskSettings,
      getTrustBehavior: vi.fn(() => ({ trustWorkspace })),
    });

    await service.maybeAutoTrust({
      providerId: 'claude',
      workspacePath: '/tmp/worktree',
      host: { kind: 'local', homedir: '/home/local-user' },
      force: true,
    });

    expect(getTaskSettings).not.toHaveBeenCalled();
    expect(trustWorkspace).toHaveBeenCalledWith(expect.any(Object), {
      workspacePath: path.normalize('/tmp/worktree'),
    });
  });

  it('does nothing when the provider has no trust behavior', async () => {
    const getTaskSettings = vi.fn(async () => ({ autoTrustWorktrees: true }));
    const service = makeService({ getTaskSettings, getTrustBehavior: vi.fn(() => undefined) });

    await service.maybeAutoTrust({
      providerId: 'claude',
      workspacePath: '/tmp/worktree',
      host: { kind: 'local', homedir: '/home/local-user' },
    });

    expect(getTaskSettings).not.toHaveBeenCalled();
  });

  it('refuses non-absolute workspace paths', async () => {
    const trustWorkspace = vi.fn();
    const service = makeService({ getTrustBehavior: vi.fn(() => ({ trustWorkspace })) });

    await service.maybeAutoTrust({
      providerId: 'claude',
      workspacePath: 'relative/worktree',
      host: { kind: 'local', homedir: '/home/local-user' },
    });

    expect(trustWorkspace).not.toHaveBeenCalled();
    expect(mockWarn).toHaveBeenCalledWith(
      'WorkspaceTrust: refusing to auto-trust non-absolute workspace path',
      { path: 'relative/worktree' }
    );
  });

  it('logs and swallows trust behavior failures', async () => {
    const service = makeService({
      getTrustBehavior: vi.fn(() => ({
        trustWorkspace: vi.fn(async () => {
          throw new Error('boom');
        }),
      })),
    });

    await service.maybeAutoTrust({
      providerId: 'claude',
      workspacePath: '/tmp/worktree',
      host: { kind: 'local', homedir: '/home/local-user' },
    });

    expect(mockWarn).toHaveBeenCalledWith('WorkspaceTrust: failed to auto-trust worktree', {
      providerId: 'claude',
      path: path.normalize('/tmp/worktree'),
      error: 'Error: boom',
    });
  });
});

function makeService(overrides: {
  getTaskSettings?: () => Promise<{ autoTrustWorktrees: boolean }>;
  getTrustBehavior?: (providerId: AgentProviderId) => ITrustBehavior | undefined;
}): WorkspaceTrustService {
  return new WorkspaceTrustService({
    getTaskSettings: overrides.getTaskSettings ?? vi.fn(async () => ({ autoTrustWorktrees: true })),
    getTrustBehavior:
      overrides.getTrustBehavior ??
      vi.fn(() => ({
        trustWorkspace: vi.fn(async () => {}),
      })),
  });
}
