import { issuesPluginRegistry } from '@emdash/plugins/issues';
import { createGitHubPluginIssueProvider } from '@core/features/github/api/node/github-plugin-issue-provider';
import type { GitHubIssueProviderDependencies } from '@core/features/github/api/node/github-plugin-issue-provider';
import { createPluginIssueProvider } from '@core/features/integrations/api/node/plugin-issue-provider';
import type { ProjectIntegrationAccountResolver } from '@core/features/integrations/api/node/services/project-integration-account-resolver';
import type { IssueProvider } from '@core/features/issues/api/node/issue-provider';
import type { IssueProviderType } from '@core/primitives/issue-providers/api';

export type IssueProviderRegistry = {
  get(type: IssueProviderType): IssueProvider | undefined;
  getAll(): IssueProvider[];
};

export function createIssueProviderRegistry(dependencies: {
  github: GitHubIssueProviderDependencies;
  /** Resolves the per-project account for non-GitHub plugin issue providers. */
  resolveProjectIntegrationAccount?: ProjectIntegrationAccountResolver;
}): IssueProviderRegistry {
  const providers = new Map<IssueProviderType, IssueProvider>();

  for (const plugin of issuesPluginRegistry.getAll()) {
    const provider =
      plugin.metadata.integrationId === 'github'
        ? createGitHubPluginIssueProvider(plugin, dependencies.github)
        : createPluginIssueProvider(plugin, {
            resolveProjectAccount: dependencies.resolveProjectIntegrationAccount,
          });
    providers.set(provider.type, provider);
  }

  return {
    get: (type) => providers.get(type),
    getAll: () => [...providers.values()],
  };
}
