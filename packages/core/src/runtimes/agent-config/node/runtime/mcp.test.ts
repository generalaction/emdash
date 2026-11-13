import { noopLogger } from '@emdash/shared/logger';
import { describe, expect, it, vi } from 'vitest';
import { createAgentConfigMcpModel } from '#runtimes/agent-config/node/state/live-models';
import type {
  CLIAgentPluginProvider,
  McpServerRegistration,
} from '#services/agent-plugins/api/plugins';
import { AgentMcpConfigManager } from './mcp';
import { ProviderEnvCache } from './provider-env-cache';
import type { AgentConfigRuntimeDeps } from './types';

function fakeProvider(id: string): CLIAgentPluginProvider {
  return {
    metadata: { id, name: id, description: id, websiteUrl: 'https://example.com' },
    capabilities: { mcp: { kind: 'supported', scope: 'global', supportedTransports: ['stdio'] } },
    behavior: { mcp: {} },
  } as unknown as CLIAgentPluginProvider;
}

function fakeDeps(overrides: {
  readMcpServers?: (
    providerId: string,
    env?: Record<string, string>
  ) => Promise<{ success: true; data: McpServerRegistration[] }>;
}): AgentConfigRuntimeDeps {
  const readMcpServers =
    overrides.readMcpServers ?? (async () => ({ success: true as const, data: [] }));
  return {
    scope: { child: () => ({ add: () => {} }) },
    logger: noopLogger,
    agentHost: {
      get: (id: string) => fakeProvider(id),
      getAll: () => [fakeProvider('claude')],
      readMcpServers,
      writeMcpServers: vi.fn(async () => ({ success: true as const })),
      removeMcpServer: vi.fn(async () => ({ success: true as const })),
    },
  } as unknown as AgentConfigRuntimeDeps;
}

describe('AgentMcpConfigManager', () => {
  it('listForAgent stores the passed env and forwards it to agentHost.readMcpServers', async () => {
    const readMcpServers = vi.fn(async () => ({ success: true as const, data: [] }));
    const providerEnv = new ProviderEnvCache();
    const manager = new AgentMcpConfigManager(
      fakeDeps({ readMcpServers }),
      createAgentConfigMcpModel(),
      providerEnv
    );

    await manager.listForAgent('claude', { CLAUDE_CONFIG_DIR: '/home/user/axoniq/.claude' });

    expect(readMcpServers).toHaveBeenCalledWith('claude', {
      CLAUDE_CONFIG_DIR: '/home/user/axoniq/.claude',
    });
    expect(providerEnv.get('claude')).toEqual({
      CLAUDE_CONFIG_DIR: '/home/user/axoniq/.claude',
    });
  });

  it('listForAgent reuses a previously warmed env when called without one', async () => {
    const readMcpServers = vi.fn(async () => ({ success: true as const, data: [] }));
    const providerEnv = new ProviderEnvCache();
    providerEnv.set('claude', { CLAUDE_CONFIG_DIR: '/home/user/axoniq/.claude' });
    const manager = new AgentMcpConfigManager(
      fakeDeps({ readMcpServers }),
      createAgentConfigMcpModel(),
      providerEnv
    );

    await manager.listForAgent('claude');

    expect(readMcpServers).toHaveBeenCalledWith('claude', {
      CLAUDE_CONFIG_DIR: '/home/user/axoniq/.claude',
    });
  });

  it('does not clear a warmed env when called without one', async () => {
    const readMcpServers = vi.fn(async () => ({ success: true as const, data: [] }));
    const providerEnv = new ProviderEnvCache();
    const manager = new AgentMcpConfigManager(
      fakeDeps({ readMcpServers }),
      createAgentConfigMcpModel(),
      providerEnv
    );

    // The separate mcp app-slice never has Settings access, so its calls
    // always omit env - that must not be read as "the override was cleared".
    await manager.listForAgent('claude', { CLAUDE_CONFIG_DIR: '/home/user/axoniq/.claude' });
    await manager.listForAgent('claude');

    expect(providerEnv.get('claude')).toEqual({
      CLAUDE_CONFIG_DIR: '/home/user/axoniq/.claude',
    });
  });
  it('republishes the list when a provider env changes', async () => {
    const readMcpServers = vi.fn(async (_providerId: string, env?: Record<string, string>) => ({
      success: true as const,
      data: [
        {
          name: env ? 'configured-server' : 'default-server',
          transport: 'stdio',
          command: 'x',
        } as unknown as McpServerRegistration,
      ],
    }));
    const providerEnv = new ProviderEnvCache();
    const model = createAgentConfigMcpModel();
    const manager = new AgentMcpConfigManager(fakeDeps({ readMcpServers }), model, providerEnv);
    await manager.initialize();
    expect(readMcpServers).toHaveBeenLastCalledWith('claude', undefined);

    providerEnv.set('claude', { CLAUDE_CONFIG_DIR: '/home/user/axoniq/.claude' });

    await vi.waitFor(() =>
      expect(readMcpServers).toHaveBeenLastCalledWith('claude', {
        CLAUDE_CONFIG_DIR: '/home/user/axoniq/.claude',
      })
    );
    manager.dispose();
  });

  it('writes to the config root the published list was read from', async () => {
    const deps = fakeDeps({});
    const providerEnv = new ProviderEnvCache();
    const manager = new AgentMcpConfigManager(deps, createAgentConfigMcpModel(), providerEnv);
    await manager.initialize();
    // Stop the env-change refresh so the published list stays on the default root.
    manager.dispose();

    providerEnv.set('claude', { CLAUDE_CONFIG_DIR: '/home/user/axoniq/.claude' });
    await manager.removeServer('foo');

    expect(deps.agentHost.removeMcpServer).toHaveBeenCalledWith('claude', 'foo', undefined);
  });
});
