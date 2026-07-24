import type { HostDependencyDefinition } from '@primitives/host-dependencies/api';

export const GIT_DEPENDENCY_DESCRIPTOR: HostDependencyDefinition = {
  id: 'git',
  name: 'Git',
  category: 'core',
  binaryNames: ['git'],
  status: 'active',
};

export const CORE_DEPENDENCIES: HostDependencyDefinition[] = [GIT_DEPENDENCY_DESCRIPTOR];
