import { pluginRegistry } from '@emdash/plugins/agents';
import type {
  DependencyDescriptor,
  DependencyStatus,
  ProbeResult,
} from '@emdash/shared/deps/runtime';

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

function buildAgentDependencies(): DependencyDescriptor[] {
  return pluginRegistry.getAll().map((provider) => {
    const { metadata, capabilities, behavior } = provider;
    const hostDep = capabilities.hostDependency;
    const binaryNames = hostDep.binaryNames;

    const updateHooks = behavior.hostDependency
      ? {
          resolveLatestVersion: behavior.hostDependency.resolveLatestVersion?.bind(
            behavior.hostDependency
          ),
          buildUpdateCommand: behavior.hostDependency.buildUpdateCommand?.bind(
            behavior.hostDependency
          ),
        }
      : undefined;

    return {
      id: metadata.id,
      name: metadata.name,
      category: 'agent' as const,
      commands: binaryNames.length > 0 ? binaryNames : [metadata.id],
      skipVersionProbe: hostDep.skipVersionProbe,
      versionArgs: hostDep.versionArgs,
      docUrl: metadata.websiteUrl,
      resolveStatus: behavior.hostDependency?.resolveStatus
        ? behavior.hostDependency.resolveStatus.bind(behavior.hostDependency)
        : agentResolveStatus,
      updates: hostDep.updates,
      installCommands: hostDep.installCommands,
      updateHooks,
    };
  });
}

export const DEPENDENCIES: DependencyDescriptor[] = buildAgentDependencies();

export function getDependencyDescriptor(id: string): DependencyDescriptor | undefined {
  return DEPENDENCIES.find((d) => d.id === id);
}
