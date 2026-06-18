import type { DependencyInstallResult, DependencyStatus } from '@emdash/core/deps/runtime';
import { createRPCController } from '@shared/lib/ipc/rpc';
import { getDependencyManager } from '../dependency-managers';

export const coreDepsController = createRPCController({
  /**
   * Probes the named core dependency and returns its current status.
   * Uses probe() rather than get() so a fresh manager always yields an up-to-date result.
   */
  getCoreDependencyStatus: async (
    id: 'boo' | 'tmux',
    connectionId?: string
  ): Promise<{ status: DependencyStatus }> => {
    const mgr = await getDependencyManager(connectionId);
    const state = await mgr.probe(id);
    return { status: state.status };
  },

  /**
   * Installs boo via the dependency manager's install pipeline.
   * Returns a DependencyInstallResult (a Result with .success).
   * The consented-install UX lives in the renderer; this is the server-side half.
   */
  installCoreDependency: async (
    id: 'boo',
    connectionId?: string
  ): Promise<DependencyInstallResult> => {
    const mgr = await getDependencyManager(connectionId);
    return mgr.install(id);
  },
});
