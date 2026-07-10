import type { CLIAgentPluginProvider } from '../agents/plugins';
import type { DependencyDescriptor, DependencyStatus, ProbeResult } from './runtime';

function agentResolveStatus(result: ProbeResult): DependencyStatus {
  if (result.path !== null) return 'available';
  if (result.timedOut && result.stdout) return 'available';
  if (result.exitCode !== null && (result.stdout || result.stderr)) return 'available';
  return result.exitCode === null ? 'missing' : 'error';
}

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
