import { pluginRegistry } from '@emdash/plugins/agents';
import type { CLIAgentPluginProvider } from '@emdash/shared/agents/plugins';
import type {
  DependencyDescriptor,
  DependencyStatus,
  ProbeResult,
} from '@emdash/shared/deps/runtime';
import { CORE_DEPENDENCIES } from './core-deps/descriptors';

/**
 * Agents that output their version on stderr, time out during probing, or return
 * a non-zero exit code are still "available" if a path was resolved or any output
 * was produced. This mirrors the logic in ConnectionsService.resolveStatus().
 */
function agentResolveStatus(result: ProbeResult): DependencyStatus {
  if (result.path !== null) return 'available';
  if (result.timedOut && result.stdout) return 'available';
  if (result.exitCode !== null && (result.stdout || result.stderr)) return 'available';
  return result.exitCode === null ? 'missing' : 'error';
}

/**
 * Maps a single plugin provider to the runtime DependencyDescriptor consumed by
 * HostDependencyManager. The explicit return type ensures all capability fields
 * that need mapping are visible in one place — omitting a field here is a
 * reviewable gap rather than a silent runtime bug.
 */
export function buildDescriptorFromProvider(
  provider: CLIAgentPluginProvider
): DependencyDescriptor {
  const { metadata, capabilities, behavior } = provider;
  const hostDep = capabilities.hostDependency;
  const binaryNames = hostDep.binaryNames;

  const commandHooks = behavior.hostDependency
    ? {
        resolveLatestVersion: behavior.hostDependency.resolveLatestVersion?.bind(
          behavior.hostDependency
        ),
        buildUpdateCommand: behavior.hostDependency.buildUpdateCommand?.bind(
          behavior.hostDependency
        ),
        buildUninstallCommand: behavior.hostDependency.buildUninstallCommand?.bind(
          behavior.hostDependency
        ),
      }
    : undefined;

  return {
    id: metadata.id,
    name: metadata.name,
    category: 'agent',
    commands: binaryNames.length > 0 ? binaryNames : [metadata.id],
    skipVersionProbe: hostDep.skipVersionProbe,
    versionArgs: hostDep.versionArgs,
    docUrl: metadata.websiteUrl,
    resolveStatus: behavior.hostDependency?.resolveStatus
      ? behavior.hostDependency.resolveStatus.bind(behavior.hostDependency)
      : agentResolveStatus,
    updates: hostDep.updates,
    installCommands: hostDep.installCommands,
    uninstall: hostDep.uninstall,
    commandHooks,
  };
}

function buildAgentDependencies(): DependencyDescriptor[] {
  return pluginRegistry.getAll().map(buildDescriptorFromProvider);
}

export const DEPENDENCIES: DependencyDescriptor[] = [
  ...buildAgentDependencies(),
  ...CORE_DEPENDENCIES,
];

export function getDependencyDescriptor(id: string): DependencyDescriptor | undefined {
  return DEPENDENCIES.find((d) => d.id === id);
}
