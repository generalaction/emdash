import { issuesPluginRegistry } from '@emdash/plugins/issues';
import { installNodeIssuePluginBindings } from '@emdash/plugins/issues/node';
import { createGitHubPluginIssueProvider } from '@core/features/github/api/node/github-plugin-issue-provider';
import type { GitHubIssueProviderDependencies } from '@core/features/github/api/node/github-plugin-issue-provider';
import { createPluginIssueProvider } from '@core/features/integrations/api/node/plugin-issue-provider';
import type { IssueProvider } from '@core/features/issues/api/node/issue-provider';
import type { IssueProviderType } from '@core/primitives/issue-providers/api';

export type IssueProviderRegistry = {
  get(type: IssueProviderType): IssueProvider | undefined;
  getAll(): IssueProvider[];
};

export function createIssueProviderRegistry(dependencies: {
  github: GitHubIssueProviderDependencies;
}): IssueProviderRegistry {
  // Providers that read the local filesystem get their node bindings here;
  // the plugin package itself stays importable from the renderer program.
  installNodeIssuePluginBindings();

  const providers = new Map<IssueProviderType, IssueProvider>();

  for (const plugin of issuesPluginRegistry.getAll()) {
    const provider =
      plugin.metadata.integrationId === 'github'
        ? createGitHubPluginIssueProvider(plugin, dependencies.github)
        : createPluginIssueProvider(plugin);
    providers.set(provider.type, provider);
  }

  return {
    get: (type) => providers.get(type),
    getAll: () => [...providers.values()],
  };
}
