import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DependencyInstallResult, DependencyState } from '@emdash/shared/deps/runtime';

// Mock getDependencyManager before importing the controller under test
vi.mock('@main/core/dependencies/dependency-managers', () => ({
  getDependencyManager: vi.fn(),
}));

import { getDependencyManager } from '@main/core/dependencies/dependency-managers';
import { coreDepsController } from './controller';

const mockGetDependencyManager = vi.mocked(getDependencyManager);

function makeMockState(
  id: string,
  status: DependencyState['status'] = 'available'
): DependencyState {
  return {
    id,
    category: 'core',
    status,
    version: '1.0.0',
    path: '/usr/local/bin/boo',
    checkedAt: Date.now(),
  };
}

describe('coreDepsController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getCoreDependencyStatus', () => {
    it('probes boo via the dependency manager and returns its status', async () => {
      const state = makeMockState('boo', 'available');
      const mgr = {
        probe: vi.fn().mockResolvedValue(state),
        install: vi.fn(),
      };
      mockGetDependencyManager.mockResolvedValue(mgr as never);

      const result = await coreDepsController.getCoreDependencyStatus('boo');

      expect(mockGetDependencyManager).toHaveBeenCalledWith(undefined);
      expect(mgr.probe).toHaveBeenCalledWith('boo');
      expect(result).toEqual({ status: 'available' });
    });

    it('probes tmux and returns missing status when not installed', async () => {
      const state = makeMockState('tmux', 'missing');
      const mgr = {
        probe: vi.fn().mockResolvedValue(state),
        install: vi.fn(),
      };
      mockGetDependencyManager.mockResolvedValue(mgr as never);

      const result = await coreDepsController.getCoreDependencyStatus('tmux');

      expect(mgr.probe).toHaveBeenCalledWith('tmux');
      expect(result).toEqual({ status: 'missing' });
    });

    it('forwards connectionId to getDependencyManager', async () => {
      const state = makeMockState('boo', 'available');
      const mgr = {
        probe: vi.fn().mockResolvedValue(state),
        install: vi.fn(),
      };
      mockGetDependencyManager.mockResolvedValue(mgr as never);

      await coreDepsController.getCoreDependencyStatus('boo', 'ssh-conn-1');

      expect(mockGetDependencyManager).toHaveBeenCalledWith('ssh-conn-1');
    });
  });

  describe('installCoreDependency', () => {
    it('delegates boo install to the dependency manager and returns its result', async () => {
      const installResult: DependencyInstallResult = {
        success: true,
        data: makeMockState('boo', 'available'),
      };
      const mgr = {
        probe: vi.fn(),
        install: vi.fn().mockResolvedValue(installResult),
      };
      mockGetDependencyManager.mockResolvedValue(mgr as never);

      const result = await coreDepsController.installCoreDependency('boo');

      expect(mockGetDependencyManager).toHaveBeenCalledWith(undefined);
      expect(mgr.install).toHaveBeenCalledWith('boo');
      expect(result).toEqual(installResult);
    });

    it('forwards connectionId when installing on a remote host', async () => {
      const installResult: DependencyInstallResult = {
        success: false,
        error: { type: 'command-failed', message: 'failed', output: '', exitCode: 1 },
      };
      const mgr = {
        probe: vi.fn(),
        install: vi.fn().mockResolvedValue(installResult),
      };
      mockGetDependencyManager.mockResolvedValue(mgr as never);

      const result = await coreDepsController.installCoreDependency('boo', 'ssh-conn-2');

      expect(mockGetDependencyManager).toHaveBeenCalledWith('ssh-conn-2');
      expect(mgr.install).toHaveBeenCalledWith('boo');
      expect(result).toEqual(installResult);
    });
  });
});
