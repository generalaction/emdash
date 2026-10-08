import type { PluginRegistry } from '@emdash/shared/plugins';
import type {
  ProvidedWireComponentRequirements,
  WireComponentWorkerCreateOptions,
} from '@emdash/wire/worker';
import type { CLIAgentPluginProvider } from '#services/agent-plugins/api/plugins';
import { createProviderUsageComponent } from './component';

type Component = ReturnType<typeof createProviderUsageComponent>;
export function providerUsageWorkerSpec(input: {
  pluginRegistry: PluginRegistry<CLIAgentPluginProvider>;
  executable: string;
  env: NodeJS.ProcessEnv;
  dependencies: ProvidedWireComponentRequirements<Component['requirements']>;
}): readonly [
  Component,
  WireComponentWorkerCreateOptions<Component['requirements'], Record<string, never>>,
] {
  return [
    createProviderUsageComponent(input),
    {
      name: 'provider-usage',
      executable: input.executable,
      env: input.env,
      dependencies: input.dependencies,
      config: {},
    },
  ];
}
