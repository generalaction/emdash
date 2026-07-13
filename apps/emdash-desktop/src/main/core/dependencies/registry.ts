import {
  CORE_DEPENDENCIES,
  type DependencyDescriptor,
  buildDescriptorFromProvider,
} from '@emdash/core/services/host-dependencies/node';
import { pluginRegistry } from '@emdash/plugins/agents';

export { buildDescriptorFromProvider };

function buildAgentDependencies(): DependencyDescriptor[] {
  return pluginRegistry.getAll().map(buildDescriptorFromProvider);
}

export const DEPENDENCIES: DependencyDescriptor[] = [
  ...CORE_DEPENDENCIES,
  ...buildAgentDependencies(),
];
export const AGENT_DEPENDENCIES = DEPENDENCIES.filter(
  (dependency) => dependency.category === 'agent'
);

export function getDependencyDescriptor(id: string): DependencyDescriptor | undefined {
  return DEPENDENCIES.find((d) => d.id === id);
}
