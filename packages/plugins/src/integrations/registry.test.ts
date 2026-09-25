import { describe, expect, it } from 'vitest';
import type { IntegrationCredentials } from './host';
import { registerIntegrationPluginBehavior } from './plugin';
import { integrationPluginRegistry } from './registry';

const credentialsByProvider: Record<string, IntegrationCredentials> = {
  asana: { accessToken: 'test-token' },
  featurebase: { apiKey: 'test-key' },
  forgejo: { instanceUrl: 'https://example.com/forgejo', apiToken: 'test-token' },
  github: { accessToken: 'test-token', apiBaseUrl: 'https://api.github.com' },
  gitlab: { instanceUrl: 'https://example.com/gitlab', apiToken: 'test-token' },
  jira: {
    siteUrl: 'https://example.atlassian.net',
    email: 'ada@example.com',
    apiToken: 'test-token',
  },
  linear: { apiKey: 'test-key' },
  monday: { apiToken: 'test-token' },
  notion: { apiToken: 'test-token' },
  plain: { apiKey: 'test-key' },
  plane: { apiBaseUrl: 'https://example.com/plane', workspaceSlug: 'acme', apiKey: 'test-key' },
  trello: { apiKey: 'test-key', apiToken: 'test-token' },
};

describe('integration credential contracts', () => {
  it('covers every registered provider', () => {
    expect(integrationPluginRegistry.ids().sort()).toEqual(
      Object.keys(credentialsByProvider).sort()
    );
  });

  it.each(Object.entries(credentialsByProvider))(
    '%s normalizes credentials and can read its own JSON payload',
    (id, credentials) => {
      const auth = integrationPluginRegistry.get(id)?.behavior.auth;
      if (!auth) throw new Error(`Missing auth behavior for ${id}`);
      const supplied = Object.fromEntries(
        Object.entries(credentials).map(([key, value]) => [key, ` ${value} `])
      );
      const normalized = auth.credentialsSchema.parse({ ...supplied, staleField: 'discard' });
      expect(normalized).toEqual(credentials);

      const restored: unknown = JSON.parse(JSON.stringify(normalized));
      expect(auth.credentialsSchema.parse(restored)).toEqual(credentials);
      for (const invalid of [null, [], {}, 'raw-token']) {
        expect(auth.credentialsSchema.safeParse(invalid).success).toBe(false);
      }
    }
  );

  it('preserves GitHub Enterprise connection config and defaults GitHub.com config', () => {
    const auth = integrationPluginRegistry.get('github')?.behavior.auth;
    if (!auth) throw new Error('Missing GitHub auth behavior');

    expect(auth.credentialsSchema.parse({ accessToken: 'test-token' })).toEqual(
      credentialsByProvider.github
    );
    expect(
      auth.credentialsSchema.parse({
        accessToken: 'test-token',
        apiBaseUrl: 'https://github.example.com/api/v3/',
      })
    ).toEqual({ accessToken: 'test-token', apiBaseUrl: 'https://github.example.com/api/v3' });
  });

  it('requires auth behavior when registering an integration', () => {
    const plugin = integrationPluginRegistry.get('github');
    if (!plugin) throw new Error('Missing GitHub integration');
    expect(() => registerIntegrationPluginBehavior(plugin, {})).toThrow(
      "Plugin 'github' declares capability 'auth' that requires behavior"
    );
  });
});
