import type { CLIAgentPluginProvider } from '@emdash/core/services/agent-plugins/api/plugins';
import { pluginRegistry } from '@emdash/plugins/agents';
import { describe, expect, it } from 'vitest';
import { buildDescriptorFromProvider, DEPENDENCIES } from './registry';

describe('buildDescriptorFromProvider', () => {
  it('maps uninstall from capability descriptor to runtime descriptor', () => {
    for (const provider of pluginRegistry.getAll()) {
      const capUninstall = provider.capabilities.hostDependency.uninstall;
      const runtimeDesc = buildDescriptorFromProvider(provider);

      if (capUninstall) {
        expect(runtimeDesc.uninstall).toEqual(capUninstall);
      }
    }
  });

  it('maps buildUninstallCommand hook from behavior to runtime descriptor commandHooks', () => {
    for (const provider of pluginRegistry.getAll()) {
      const hookFn = provider.behavior.hostDependency?.buildUninstallCommand;
      const runtimeDesc = buildDescriptorFromProvider(provider);

      if (hookFn) {
        expect(runtimeDesc.commandHooks?.buildUninstallCommand).toBeDefined();
      }
    }
  });

  it('maps buildUpdateCommand hook from behavior to runtime descriptor commandHooks', () => {
    for (const provider of pluginRegistry.getAll()) {
      const hookFn = provider.behavior.hostDependency?.buildUpdateCommand;
      const runtimeDesc = buildDescriptorFromProvider(provider);

      if (hookFn) {
        expect(runtimeDesc.commandHooks?.buildUpdateCommand).toBeDefined();
      }
    }
  });
});

describe('DEPENDENCIES', () => {
  it('contains core dependencies', () => {
    expect(DEPENDENCIES).toContainEqual(
      expect.objectContaining({ id: 'git', category: 'core', commands: ['git'] })
    );
  });

  it('contains an entry for every registered plugin', () => {
    const pluginIds = pluginRegistry.getAll().map((p: CLIAgentPluginProvider) => p.metadata.id);
    for (const id of pluginIds) {
      expect(DEPENDENCIES.find((d) => d.id === id)).toBeDefined();
    }
  });
});
