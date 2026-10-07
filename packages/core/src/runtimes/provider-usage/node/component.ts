import os from 'node:os';
import type { PluginRegistry } from '@emdash/shared/plugins';
import { createController } from '@emdash/wire/rpc';
import { defineWireComponent, requireContract } from '@emdash/wire/worker';
import { z } from 'zod';
import { AgentPluginHost, type CLIAgentPluginProvider } from '#services/agent-plugins/api/plugins';
import { createLocalPluginFs } from '#services/agent-plugins/api/plugins/helpers';
import { NodeExecutionContext } from '#services/exec/api';
import {
  createHostDependencyResolverFromDependency,
  hostDependencyResolverContract,
} from '#services/host-dependencies/node';
import { userShellEnvContract } from '#services/shell-env/api';
import { providerUsageContract } from '../api';
import { ProviderUsageRuntime, type UsageProbe } from './runtime';

export function createProviderUsageComponent(options: {
  pluginRegistry: PluginRegistry<CLIAgentPluginProvider>;
}) {
  return defineWireComponent({
    id: 'provider-usage',
    contract: providerUsageContract,
    requirements: {
      hostDependencies: requireContract(hostDependencyResolverContract),
      userEnv: requireContract(userShellEnvContract),
    },
    configSchema: z.object({}),
    create: ({ dependencies, scope, instance }) => {
      const env = () => dependencies.userEnv.get();
      const homeDir = os.homedir();
      const agentHost = new AgentPluginHost({
        scope,
        registry: options.pluginRegistry,
        exec: new NodeExecutionContext({ env }),
        dependencies: createHostDependencyResolverFromDependency(dependencies.hostDependencies),
        fs: createLocalPluginFs(homeDir),
        env,
        homeDir,
      });
      const probes: UsageProbe[] = agentHost.getAll().flatMap((provider): UsageProbe[] => {
        const behavior = provider.behavior.usageLimits;
        if (!behavior || provider.capabilities.usageLimits.kind !== 'supported') return [];
        return [
          {
            providerId: provider.metadata.id,
            read: async (signal) => {
              const context = await agentHost.resolveSpawnContext(provider.metadata.id);
              signal.throwIfAborted();
              if (!context.success)
                return {
                  status: 'missing-cli',
                  windows: [],
                  message: `${provider.metadata.name} is not installed on this machine.`,
                };
              return behavior.probe({
                cli: context.data.cli,
                env: context.data.agentEnv,
                cwd: homeDir,
                signal,
              });
            },
          },
        ];
      });
      const runtime = new ProviderUsageRuntime(scope, probes);
      return instance({
        scope,
        controller: createController(providerUsageContract, {
          snapshot: runtime.snapshotHost,
          refresh: () => runtime.refresh(),
        }),
      });
    },
  });
}
