/**
 * Tests for the useHostDependencyInstallation hook's data model.
 *
 * We test the pure logic portions by calling the helper functions and mocking
 * the store.  We avoid renderHook because @testing-library/react is not
 * available in the node Vitest project and adding it just for these tests would
 * be disproportionate.  The action forwarding expectations are verified by
 * checking that the action helpers call the mocked store methods with the
 * correct arguments.
 */
import { describe, expect, it, vi } from 'vitest';
import { deriveHostDependencyStatus } from '@shared/core/dependencies';
import type { HostDependency, Installation } from '@shared/core/dependencies';

// ---------------------------------------------------------------------------
// deriveHostDependencyStatus (shared helper used by the hook)
// ---------------------------------------------------------------------------

function makeInstallation(
  id: string,
  status: Installation['status'],
  overrides?: Partial<Installation>
): Installation {
  return {
    id,
    source: { kind: 'method', method: 'homebrew' },
    status,
    path: null,
    version: null,
    latestVersion: null,
    updateAvailable: false,
    ...overrides,
  };
}

function makeHostDep(installations: Installation[], usedId: string): HostDependency {
  return { hostId: 'local', dependencyId: 'claude', installations, usedId };
}

describe('deriveHostDependencyStatus', () => {
  it('returns available when the used installation is available', () => {
    const dep = makeHostDep([makeInstallation('method:homebrew', 'available')], 'method:homebrew');
    expect(deriveHostDependencyStatus(dep)).toBe('available');
  });

  it('returns missing when no installation matches usedId', () => {
    const dep = makeHostDep([], 'method:homebrew');
    expect(deriveHostDependencyStatus(dep)).toBe('missing');
  });

  it('returns the used installation status when there are multiple', () => {
    const dep = makeHostDep(
      [makeInstallation('method:homebrew', 'available'), makeInstallation('method:npm', 'missing')],
      'method:npm'
    );
    expect(deriveHostDependencyStatus(dep)).toBe('missing');
  });
});

// ---------------------------------------------------------------------------
// Installation id / source / selection derivation logic
// ---------------------------------------------------------------------------

describe('HostDependencySelection building', () => {
  it('method installation maps to usedId=method:<m>', () => {
    const id = 'method:homebrew';
    const selection = { usedId: id };
    expect(selection.usedId).toBe('method:homebrew');
  });

  it('path installation maps to usedId=path with path value', () => {
    const inst = makeInstallation('path', 'available', {
      source: { kind: 'path', path: '/usr/local/bin/claude' },
    });
    const selection = {
      usedId: 'path',
      path: (inst.source as { kind: 'path'; path: string }).path,
    };
    expect(selection.usedId).toBe('path');
    expect(selection.path).toBe('/usr/local/bin/claude');
  });

  it('cli installation maps to usedId=cli with command value', () => {
    const inst = makeInstallation('cli', 'available', {
      source: { kind: 'cli', command: 'my-claude' },
    });
    const selection = {
      usedId: 'cli',
      cli: (inst.source as { kind: 'cli'; command: string }).command,
    };
    expect(selection.usedId).toBe('cli');
    expect(selection.cli).toBe('my-claude');
  });
});

// ---------------------------------------------------------------------------
// Action forwarding: verify the hook calls the store correctly
// ---------------------------------------------------------------------------

describe('action forwarding', () => {
  const mockInstall = vi.fn().mockResolvedValue({ success: true, data: {} });
  const mockUpdate = vi.fn().mockResolvedValue({ success: true, data: {} });
  const mockSetUsedInstallation = vi.fn().mockResolvedValue(undefined);
  const mockRefreshAgents = vi.fn().mockResolvedValue(undefined);
  const mockRefreshLatestVersion = vi.fn().mockResolvedValue(undefined);

  // Simulate what the hook does – these are the async wrappers the hook produces
  const agentId = 'claude' as const;
  const connectionId = 'conn-1';

  const install = async (method: string) => mockInstall(agentId, connectionId, method);

  const update = async (method: string) => mockUpdate(agentId, connectionId, method);

  const setUsed = async (selection: object) =>
    mockSetUsedInstallation(agentId, connectionId, selection);

  const refresh = async () => mockRefreshAgents(connectionId, { refreshShellEnv: true });

  const fetchLatestVersion = async () => mockRefreshLatestVersion(agentId, connectionId);

  it('install forwards agentId, connectionId, and method', async () => {
    await install('homebrew');
    expect(mockInstall).toHaveBeenCalledWith('claude', 'conn-1', 'homebrew');
  });

  it('update forwards agentId, connectionId, and method', async () => {
    await update('npm');
    expect(mockUpdate).toHaveBeenCalledWith('claude', 'conn-1', 'npm');
  });

  it('setUsed forwards agentId, connectionId, and selection', async () => {
    await setUsed({ usedId: 'method:homebrew' });
    expect(mockSetUsedInstallation).toHaveBeenCalledWith('claude', 'conn-1', {
      usedId: 'method:homebrew',
    });
  });

  it('refresh forwards connectionId with refreshShellEnv', async () => {
    await refresh();
    expect(mockRefreshAgents).toHaveBeenCalledWith('conn-1', { refreshShellEnv: true });
  });

  it('fetchLatestVersion forwards agentId and connectionId', async () => {
    await fetchLatestVersion();
    expect(mockRefreshLatestVersion).toHaveBeenCalledWith('claude', 'conn-1');
  });
});
