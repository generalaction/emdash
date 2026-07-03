import { issuesPluginRegistry } from '@emdash/plugins/issues';
import { createGitHubPluginIssueProvider } from '@main/core/github/github-plugin-issue-provider';
import { createPluginIssueProvider } from '@main/core/integrations/plugin-issue-provider';
import type { IssueProviderType } from '@shared/issue-providers';
import type { IssueProvider } from './issue-provider';

const providers = new Map<IssueProviderType, IssueProvider>();

function register(provider: IssueProvider) {
  providers.set(provider.type, provider);
}

for (const plugin of issuesPluginRegistry.getAll()) {
  const provider =
    plugin.metadata.integrationId === 'github'
      ? createGitHubPluginIssueProvider(plugin)
      : createPluginIssueProvider(plugin);
  register(provider);
}

export function getIssueProvider(type: IssueProviderType): IssueProvider | undefined {
  return providers.get(type);
}

export function getAllIssueProviders(): IssueProvider[] {
  return [...providers.values()];
}
