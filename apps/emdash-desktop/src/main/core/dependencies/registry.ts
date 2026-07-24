import { buildDescriptorFromProvider } from '@emdash/core/services/agent-plugins/api/plugins';
import {
  CORE_DEPENDENCIES,
  type HostDependencyDefinition,
} from '@emdash/core/services/host-dependencies/node';
import { pluginRegistry } from '@emdash/plugins/agents';

export { buildDescriptorFromProvider };

function buildAgentDependencies(): HostDependencyDefinition[] {
  return pluginRegistry.getAll().map(buildDescriptorFromProvider);
}

export const DEPENDENCIES: HostDependencyDefinition[] = [
  ...CORE_DEPENDENCIES,
  ...buildAgentDependencies(),
];
export const AGENT_DEPENDENCIES = DEPENDENCIES.filter(
  (dependency) => dependency.category === 'agent'
);

export function getDependencyDescriptor(id: string): HostDependencyDefinition | undefined {
  return DEPENDENCIES.find((d) => d.id === id);
}
