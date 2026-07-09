import type { PluginRegistry } from '@emdash/shared/plugins';
import type { IAcpBehavior } from './capabilities/acp';
import type { AgentAuthDescriptor, IAgentAuthBehavior } from './capabilities/auth';
import type { CLIAgentPluginProvider } from './index';

export type ResolvedAcpProvider = {
  behavior: IAcpBehavior;
};

export type ResolvedAuthProvider = {
  name: string;
  auth: AgentAuthDescriptor;
  behavior?: IAgentAuthBehavior;
};

export type ResolvedTuiProvider = {
  name: string;
  prompt: CLIAgentPluginProvider['capabilities']['prompt'];
  hooks: CLIAgentPluginProvider['capabilities']['hooks'];
  buildCommand: NonNullable<CLIAgentPluginProvider['behavior']['prompt']>['buildCommand'];
  parseHookEvent?: NonNullable<CLIAgentPluginProvider['behavior']['hooks']>['parseHookEvent'];
};

export class AgentPluginHost {
  constructor(private readonly registry: PluginRegistry<CLIAgentPluginProvider>) {}

  get(providerId: string): CLIAgentPluginProvider | undefined {
    return this.registry.get(providerId);
  }

  getAll(): CLIAgentPluginProvider[] {
    return this.registry.getAll();
  }

  resolveAcp(providerId: string): ResolvedAcpProvider | null {
    const plugin = this.registry.get(providerId);
    if (!plugin || plugin.capabilities.acp.kind !== 'supported' || !plugin.behavior.acp) {
      return null;
    }

    return { behavior: plugin.behavior.acp };
  }

  resolveAuthProvider(providerId: string): ResolvedAuthProvider | null {
    const plugin = this.registry.get(providerId);
    if (!plugin) return null;

    return {
      name: plugin.metadata.name,
      auth: plugin.capabilities.auth,
      behavior: plugin.behavior.auth,
    };
  }

  resolveTuiProvider(providerId: string): ResolvedTuiProvider | null {
    const plugin = this.registry.get(providerId);
    const prompt = plugin?.behavior.prompt;
    if (!plugin || !prompt) return null;

    return {
      name: plugin.metadata.name,
      prompt: plugin.capabilities.prompt,
      hooks: plugin.capabilities.hooks,
      buildCommand: prompt.buildCommand,
      parseHookEvent: plugin.behavior.hooks?.parseHookEvent,
    };
  }
}
