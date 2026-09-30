import { issuesPluginRegistry } from '@emdash/plugins/issues';
import { createPluginIssueProvider } from '@core/features/integrations/api/node/plugin-issue-provider';
import type { PluginIssueProviderDependencies } from '@core/features/integrations/api/node/plugin-issue-provider';
import type { IssueProvider } from '@core/features/issues/api/node/issue-provider';
import type { IssueProviderType } from '@core/primitives/issue-providers/api';

export type IssueProviderRegistry = {
  get(type: IssueProviderType): IssueProvider | undefined;
  getAll(): IssueProvider[];
};

export function createIssueProviderRegistry(
  dependencies: PluginIssueProviderDependencies
): IssueProviderRegistry {
  const providers = new Map<IssueProviderType, IssueProvider>();

  for (const plugin of issuesPluginRegistry.getAll()) {
    const provider = createPluginIssueProvider(plugin, dependencies);
    providers.set(provider.type, provider);
  }

  return {
    get: (type) => providers.get(type),
    getAll: () => [...providers.values()],
  };
}
