import type { DependencyCategory, DependencyId } from '@shared/core/dependencies';
import { createRPCController } from '@shared/lib/ipc/rpc';
import { getDependencyManager } from './dependency-manager';
import type { DependencyProbeOptions } from './types';

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
  install: async (id: DependencyId, connectionId?: string) => {
    const mgr = await getDependencyManager(connectionId);
    return mgr.install(id);
  },
});
