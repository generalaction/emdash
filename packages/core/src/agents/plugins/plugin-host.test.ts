import { describe, expect, it } from 'vitest';
import type { IAcpBehavior } from './capabilities/acp';
import type { IAgentAuthBehavior } from './capabilities/auth';
import { AgentPluginHost, createPluginRegistry, type CLIAgentPluginProvider } from './index';

describe('AgentPluginHost', () => {
  it('resolves supported ACP providers', () => {
    const acpBehavior = {} as IAcpBehavior;
    const host = createHost([
      plugin({
        acp: { kind: 'supported' },
        behavior: { acp: acpBehavior },
      }),
    ]);

    expect(host.resolveAcp('test')).toEqual({ behavior: acpBehavior });
  });

  it('returns null when a provider does not support ACP', () => {
    const host = createHost([plugin()]);

    expect(host.resolveAcp('test')).toBeNull();
  });

  it('resolves auth providers with metadata and behavior', () => {
    const authBehavior: IAgentAuthBehavior = {
      checkStatus: async () => ({ kind: 'unknown' }),
    };
    const host = createHost([
      plugin({
        auth: {
          kind: 'supported',
          methods: [
            {
              kind: 'api-key',
              id: 'api-key',
              name: 'API Key',
              envVars: [{ name: 'TEST_API_KEY', label: 'API key' }],
            },
          ],
        },
        behavior: { auth: authBehavior },
      }),
    ]);

    expect(host.resolveAuthProvider('test')).toEqual({
      name: 'Test Agent',
      auth: {
        kind: 'supported',
        methods: [
          {
            kind: 'api-key',
            id: 'api-key',
            name: 'API Key',
            envVars: [{ name: 'TEST_API_KEY', label: 'API key' }],
          },
        ],
      },
      behavior: authBehavior,
    });
  });
});

function createHost(plugins: CLIAgentPluginProvider[]): AgentPluginHost {
  const registry = createPluginRegistry<CLIAgentPluginProvider>();
  for (const item of plugins) registry.register(item);
  return new AgentPluginHost(registry);
}

function plugin(
  overrides: {
    acp?: { kind: 'none' } | { kind: 'supported' };
    auth?:
      | { kind: 'none' }
      | {
          kind: 'supported';
          methods: [
            {
              kind: 'api-key';
              id: string;
              name: string;
              envVars: [{ name: string; label: string }];
            },
          ];
        };
    behavior?: Partial<CLIAgentPluginProvider['behavior']>;
  } = {}
): CLIAgentPluginProvider {
  return {
    metadata: {
      id: 'test',
      name: 'Test Agent',
      description: 'Test agent',
      websiteUrl: 'https://example.com',
    },
    capabilities: {
      acp: overrides.acp ?? { kind: 'none' },
      auth: overrides.auth ?? { kind: 'none' },
    },
    behavior: overrides.behavior ?? {},
  } as unknown as CLIAgentPluginProvider;
}
