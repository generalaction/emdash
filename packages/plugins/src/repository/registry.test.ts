import { describe, expect, it } from 'vitest';
import { integrationPluginRegistry } from '../integrations';
import { repositoryPluginRegistry } from './registry';

describe('repository plugin registry', () => {
  it('registers valid repository plugins for existing integrations', () => {
    const ids = repositoryPluginRegistry.ids();
    expect(new Set(ids).size).toBe(ids.length);
    for (const integrationId of ids) {
      expect(integrationPluginRegistry.get(integrationId)).toBeDefined();
    }
    for (const plugin of repositoryPluginRegistry.getAll()) {
      expect(plugin.validate()).toEqual([]);
      expect(plugin.behavior.repository).toBeDefined();
    }
  });

  it('registers GitHub as the owner of github.com', () => {
    expect(repositoryPluginRegistry.get('github')?.capabilities.repository.knownHosts).toEqual([
      'github.com',
    ]);
  });

  it('registers GitLab as the owner of gitlab.com without a host probe', () => {
    const gitlab = repositoryPluginRegistry.get('gitlab');
    expect(gitlab?.capabilities.repository.knownHosts).toEqual(['gitlab.com']);
    expect(gitlab?.behavior.repository?.probeHost).toBeUndefined();
  });
});
