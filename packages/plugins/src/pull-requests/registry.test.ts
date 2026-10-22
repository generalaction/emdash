import { describe, expect, it } from 'vitest';
import { integrationPluginRegistry } from '../integrations';
import { pullRequestsPluginRegistry } from './registry';

describe('pull-request plugin registry', () => {
  it('registers valid pull-request plugins for existing integrations', () => {
    const pullRequestIntegrationIds = pullRequestsPluginRegistry.ids();

    expect(new Set(pullRequestIntegrationIds).size).toBe(pullRequestIntegrationIds.length);

    for (const integrationId of pullRequestIntegrationIds) {
      expect(integrationPluginRegistry.get(integrationId)).toBeDefined();
    }

    for (const plugin of pullRequestsPluginRegistry.getAll()) {
      expect(plugin.validate()).toEqual([]);
      expect(plugin.behavior.pullRequests).toBeDefined();
    }
  });

  it('registers the GitHub pull-request plugin', () => {
    expect(pullRequestsPluginRegistry.get('github')).toBeDefined();
    expect(pullRequestsPluginRegistry.get('gitlab')).toBeDefined();
  });
});
