import type { InstallMethod } from '@emdash/cli-agent-plugins';
import type {
  DependencyCategory,
  DependencyId,
  HostDependency,
  HostDependencySelection,
} from '@emdash/shared/deps';
import type { DependencyProbeOptions } from '@emdash/shared/deps';
import { createRPCController } from '@shared/lib/ipc/rpc';
import { getDependencyManager } from './dependency-managers';

export const dependenciesController = createRPCController({
  getAll: async (connectionId?: string) => {
    const mgr = await getDependencyManager(connectionId);
    return Object.fromEntries(mgr.getAll());
  },
  get: async (id: DependencyId, connectionId?: string) => {
    const mgr = await getDependencyManager(connectionId);
    return mgr.get(id);
  },
  getByCategory: async (cat: DependencyCategory, connectionId?: string) => {
    const mgr = await getDependencyManager(connectionId);
    return mgr.getByCategory(cat);
  },
  probe: async (id: DependencyId, connectionId?: string) => {
    const mgr = await getDependencyManager(connectionId);
    return mgr.probe(id);
  },
  probeAll: async (connectionId?: string, options?: DependencyProbeOptions) => {
    const mgr = await getDependencyManager(connectionId);
    return mgr.probeAll(options);
  },
  probeCategory: async (
    cat: DependencyCategory,
    connectionId?: string,
    options?: DependencyProbeOptions
  ) => {
    const mgr = await getDependencyManager(connectionId);
    return mgr.probeCategory(cat, options);
  },
  install: async (id: DependencyId, connectionId?: string, method?: InstallMethod) => {
    const mgr = await getDependencyManager(connectionId);
    return mgr.install(id, method);
  },
  /** Fixed: now forwards the method argument (previously dropped). */
  update: async (id: DependencyId, connectionId?: string, method?: InstallMethod) => {
    const mgr = await getDependencyManager(connectionId);
    return mgr.update(id, method);
  },
  getHostDependency: async (
    id: DependencyId,
    connectionId?: string
  ): Promise<HostDependency | undefined> => {
    const mgr = await getDependencyManager(connectionId);
    return mgr.getHostDependency(id);
  },
  setUsedInstallation: async (
    id: DependencyId,
    connectionId?: string,
    selection?: HostDependencySelection
  ): Promise<void> => {
    if (!selection) return;
    const mgr = await getDependencyManager(connectionId);
    await mgr.setSelection(id, selection);
  },
  refreshLatestVersion: async (id: DependencyId, connectionId?: string): Promise<void> => {
    const mgr = await getDependencyManager(connectionId);
    await mgr.fetchLatestVersion(id);
  },
});
