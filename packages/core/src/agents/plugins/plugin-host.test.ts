import { describe, expect, it } from 'vitest';
import type { IAcpBehavior } from './capabilities/acp';
import type { IAgentAuthBehavior } from './capabilities/auth';
import type { CanonicalHookEvent } from './capabilities/hooks';
import type { AgentCommand, CommandContext } from './capabilities/prompt';
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

  it('resolves TUI providers with prompt and hook behavior', () => {
    const buildCommand = (_ctx: CommandContext): AgentCommand => ({
      command: 'test',
      args: [],
      env: {},
    });
    const parseHookEvent = (): CanonicalHookEvent => ({ kind: 'ignore' });
    const host = createHost([
      plugin({
        prompt: { kind: 'keystroke', submitSequence: '\r' },
        hooks: { kind: 'config', scope: 'workspace', supportedEvents: ['start'] },
        behavior: {
          prompt: { buildCommand },
          hooks: {
            readHooks: async () => [],
            writeHooks: async () => [],
            deleteHooks: async () => {},
            getHooksInstalled: async () => false,
            parseHookEvent,
          },
        },
      }),
    ]);

    expect(host.resolveTuiProvider('test')).toEqual({
      name: 'Test Agent',
      prompt: { kind: 'keystroke', submitSequence: '\r' },
      hooks: { kind: 'config', scope: 'workspace', supportedEvents: ['start'] },
      buildCommand,
      parseHookEvent,
    });
  });

  it('returns null when a provider has no TUI prompt behavior', () => {
    const host = createHost([plugin()]);

    expect(host.resolveTuiProvider('test')).toBeNull();
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
    prompt?: CLIAgentPluginProvider['capabilities']['prompt'];
    hooks?: CLIAgentPluginProvider['capabilities']['hooks'];
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
      prompt: overrides.prompt ?? { kind: 'argv' },
      hooks: overrides.hooks ?? { kind: 'none' },
    },
    behavior: overrides.behavior ?? {},
  } as unknown as CLIAgentPluginProvider;
}
