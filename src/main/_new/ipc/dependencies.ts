import { createRPCController } from '@shared/ipc/rpc';
import { localDependencyManager } from '../services/LocalDependencyManager';
import { DependencyCategory, DependencyId } from '../dependencies/types';

export const dependenciesController = createRPCController({
  getAll: () => Object.fromEntries(localDependencyManager.getAll()),
  get: (id: DependencyId) => localDependencyManager.get(id),
  getByCategory: (cat: DependencyCategory) => localDependencyManager.getByCategory(cat),
  probe: (id: DependencyId) => localDependencyManager.probe(id),
  probeAll: () => localDependencyManager.probeAll(),
  probeCategory: (cat: DependencyCategory) => localDependencyManager.probeCategory(cat),
});
