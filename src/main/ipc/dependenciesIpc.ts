import { createRPCController } from '../../shared/ipc/rpc';
import { localDependencyManager as dependencyManager } from '../services/LocalDependencyManager';
import { getDependencyDescriptor } from '../core/dependencies/registry';
import type { DependencyCategory, DependencyId } from '../core/dependencies/types';

export const dependenciesController = createRPCController({
  getAll: () => Object.fromEntries(dependencyManager.getAll()),

  get: (id: DependencyId) => {
    const state = dependencyManager.get(id);
    return state ?? null;
  },

  getByCategory: (cat: DependencyCategory) => dependencyManager.getByCategory(cat),

  probe: (id: DependencyId) => dependencyManager.probe(id),

  probeAll: () => dependencyManager.probeAll(),

  probeCategory: (cat: DependencyCategory) => dependencyManager.probeCategory(cat),

  getInstallCommand: (id: DependencyId) => getDependencyDescriptor(id)?.installCommand ?? null,

  install: (id: DependencyId) => dependencyManager.install(id),
});
