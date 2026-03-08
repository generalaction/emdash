import { createRPCController } from '@shared/ipc/rpc';
import { DependencyCategory, DependencyId } from '../core/dependencies/types';
import { localDependencyManager } from '../services/LocalDependencyManager';

export const dependenciesController = createRPCController({
  getAll: () => Object.fromEntries(localDependencyManager.getAll()),
  get: (id: DependencyId) => localDependencyManager.get(id),
  getByCategory: (cat: DependencyCategory) => localDependencyManager.getByCategory(cat),
  probe: (id: DependencyId) => localDependencyManager.probe(id),
  probeAll: () => localDependencyManager.probeAll(),
  probeCategory: (cat: DependencyCategory) => localDependencyManager.probeCategory(cat),
});
