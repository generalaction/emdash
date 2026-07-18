import { createScope } from '@emdash/wire/util';
import { describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '../../exec';
import type { IAcpBehavior } from './capabilities/acp';
import type { IAgentAuthBehavior } from './capabilities/auth';
import type { CanonicalHookEvent } from './capabilities/hooks';
import type { McpServerRegistration } from './capabilities/mcp';
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

  it('builds prompt commands with resolved cli and allowlisted env', async () => {
    const buildCommand = vi.fn(
      (ctx: CommandContext): AgentCommand => ({
        command: ctx.cli,
        args: [ctx.model],
        env: { COMMAND_ENV: '1' },
      })
    );
    const host = createHost([
      plugin({
        behavior: { prompt: { buildCommand } },
      }),
    ]);

    const result = await host.buildPromptCommand('test', {
      autoApprove: false,
      model: 'sonnet',
    });

    expect(result).toMatchObject({
      success: true,
      data: {
        command: 'test',
        args: ['sonnet'],
        env: expect.objectContaining({
          HOME: '/home/test',
          PATH: '/bin',
          COMMAND_ENV: '1',
        }),
      },
    });
  });

  it('binds machine dependencies for auth status checks', async () => {
    const checkStatus = vi.fn(async () => ({ kind: 'authenticated' as const, account: 'ada' }));
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
        behavior: { auth: { checkStatus } },
      }),
    ]);

    await expect(host.checkAuthStatus('test')).resolves.toEqual({
      success: true,
      data: { kind: 'authenticated', account: 'ada' },
    });
    expect(checkStatus).toHaveBeenCalledWith({
      cli: 'test',
      exec: expect.any(Function),
      fs: expect.any(Object),
      env: expect.objectContaining({
        HOME: '/home/test',
        PATH: '/bin',
      }),
    });
  });

  it('binds plugin fs for MCP server reads', async () => {
    const servers: McpServerRegistration[] = [{ name: 'server', command: 'node' }];
    const readServers = vi.fn(async () => servers);
    const host = createHost([
      plugin({
        mcp: { kind: 'supported', scope: 'global', supportedTransports: ['stdio'] },
        behavior: {
          mcp: {
            readServers,
            writeServers: async () => {},
            removeServer: async () => {},
          },
        },
      }),
    ]);

    await expect(host.readMcpServers('test')).resolves.toEqual({ success: true, data: servers });
    expect(readServers).toHaveBeenCalledWith(expect.any(Object));
  });
});

function createHost(plugins: CLIAgentPluginProvider[]): AgentPluginHost {
  const registry = createPluginRegistry<CLIAgentPluginProvider>();
  for (const item of plugins) registry.register(item);
  return new AgentPluginHost({
    scope: createScope({ label: 'test' }),
    registry,
    exec: fakeExec(),
    fs: memoryFs(),
    env: { HOME: '/home/test', PATH: '/bin', UNSAFE_ENV: 'nope' },
    homeDir: '/home/test',
  });
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
    mcp?: CLIAgentPluginProvider['capabilities']['mcp'];
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
      mcp: overrides.mcp ?? { kind: 'none' },
      hostDependency: {
        binaryNames: ['test'],
        installCommands: {},
        updates: { kind: 'none' },
      },
    },
    behavior: overrides.behavior ?? {},
  } as unknown as CLIAgentPluginProvider;
}

function fakeExec(): IExecutionContext {
  return {
    supportsLocalSpawn: false,
    async exec() {
      throw new Error('missing');
    },
    async execStreaming() {},
    dispose() {},
  };
}

function memoryFs() {
  return {
    async read() {
      return null;
    },
    async write() {},
    async delete() {},
    async exists() {
      return false;
    },
    async list() {
      return [];
    },
  };
}
