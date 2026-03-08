import { createRPCController } from '@shared/ipc/rpc';
import { localDependencyManager } from './dependency-manager';
import { DependencyCategory, DependencyId } from './types';

export const dependenciesController = createRPCController({
  getAll: () => Object.fromEntries(localDependencyManager.getAll()),
  get: (id: DependencyId) => localDependencyManager.get(id),
  getByCategory: (cat: DependencyCategory) => localDependencyManager.getByCategory(cat),
  probe: (id: DependencyId) => localDependencyManager.probe(id),
  probeAll: () => localDependencyManager.probeAll(),
  probeCategory: (cat: DependencyCategory) => localDependencyManager.probeCategory(cat),
});
