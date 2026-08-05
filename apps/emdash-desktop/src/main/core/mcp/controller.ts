import type { CLIAgentPluginProvider } from '@emdash/core/agents/plugins';
import type { DependencyId } from '@emdash/core/deps/runtime';
import { pluginRegistry } from '@emdash/plugins/agents';
import {
  ensureAgentDependenciesProbed,
  localDependencyManager,
} from '@main/core/dependencies/dependency-managers';
import { log } from '@main/lib/logger';
import type { McpProvidersResponse, McpServer } from '@shared/core/mcp/types';
import { createRPCController } from '@shared/lib/ipc/rpc';
import { mcpService } from './services/McpService';

function mapProviders(): McpProvidersResponse[] {
  return pluginRegistry
    .getAll()
    .filter((p: CLIAgentPluginProvider) => p.capabilities.mcp.kind === 'supported')
    .map((p: CLIAgentPluginProvider) => {
      const dep = localDependencyManager.get(p.metadata.id as DependencyId);
      const mcp = p.capabilities.mcp;
      const supportsHttp = mcp.kind === 'supported' && mcp.supportedTransports.includes('http');
      return {
        id: p.metadata.id,
        name: p.metadata.name,
        installed: dep?.status === 'available',
        supportsHttp,
      };
    });
}

export const mcpController = createRPCController({
  searchIntegrationsSh: async ({ query }: { query: string }) => {
    try {
      const data = await mcpService.searchIntegrationsSh(query);
      return { success: true, data };
    } catch (error) {
      log.error('Failed to search integrations.sh:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

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
      await ensureAgentDependenciesProbed(localDependencyManager);
      return { success: true, data: mapProviders() };
    } catch (error) {
      log.error('Failed to get MCP providers:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  refreshProviders: async () => {
    try {
      await localDependencyManager.probeCategory('agent', { refreshShellEnv: true });
      return { success: true, data: mapProviders() };
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
