import type { CLIAgentPluginProvider } from '@emdash/core/services/agent-plugins/api/plugins';
import type { HostDependencySnapshot } from '@emdash/core/services/host-dependencies/node';
import { pluginRegistry } from '@emdash/plugins/agents';
import { localDependencyManager } from '@main/core/dependencies/dependency-managers';
import { log } from '@main/lib/logger';
import type { McpProvidersResponse, McpServer } from '@shared/core/mcp/types';
import { createRPCController } from '@shared/lib/ipc/rpc';
import { mcpService } from './services/McpService';

function mapProviders(snapshot: HostDependencySnapshot): McpProvidersResponse[] {
  return pluginRegistry
    .getAll()
    .filter((p: CLIAgentPluginProvider) => p.capabilities.mcp.kind === 'supported')
    .map((p: CLIAgentPluginProvider) => {
      const mcp = p.capabilities.mcp;
      const supportsHttp = mcp.kind === 'supported' && mcp.supportedTransports.includes('http');
      const dep = snapshot.dependencies[p.metadata.id];
      return {
        id: p.metadata.id,
        name: p.metadata.name,
        installed: dep?.status === 'available',
        supportsHttp,
      };
    });
}

export const mcpController = createRPCController({
  loadAll: async () => {
    try {
      const data = await mcpService.loadAll();
      return { success: true, data };
    } catch (error) {
      log.error('Failed to load MCP servers:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  saveServer: async (server: McpServer) => {
    try {
      await mcpService.saveServer(server);
      return { success: true };
    } catch (error) {
      log.error('Failed to save MCP server:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  removeServer: async (serverName: string) => {
    try {
      await mcpService.removeServer(serverName);
      return { success: true };
    } catch (error) {
      log.error('Failed to remove MCP server:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  getProviders: async () => {
    try {
      const snapshot = await dependencySnapshot();
      return { success: true, data: mapProviders(snapshot) };
    } catch (error) {
      log.error('Failed to get MCP providers:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  refreshProviders: async () => {
    try {
      const snapshot = await dependencySnapshot(true);
      return { success: true, data: mapProviders(snapshot) };
    } catch (error) {
      log.error('Failed to refresh MCP providers:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  listForAgent: async (agentId: string) => {
    try {
      const data = await mcpService.listForAgent(agentId);
      return { success: true, data };
    } catch (error) {
      log.error('Failed to list MCP servers for agent:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
});

async function dependencySnapshot(refresh = false): Promise<HostDependencySnapshot> {
  if (refresh) {
    await localDependencyManager.snapshot.mutate('refresh', { key: undefined, input: {} });
  }
  return (await localDependencyManager.snapshot.state(undefined, 'current').snapshot()).data;
}
