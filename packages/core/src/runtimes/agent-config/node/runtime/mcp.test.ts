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
});
