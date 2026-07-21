import type { CLIAgentPluginProvider } from '@emdash/core/agents/plugins';
import type { DependencyId } from '@emdash/core/deps/runtime';
import { pluginRegistry } from '@emdash/plugins/agents';
import { localDependencyManager } from '@main/core/dependencies/dependency-managers';
import { log } from '@main/lib/logger';
import type { McpProvidersResponse, McpServer } from '@shared/core/mcp/types';
import { createRPCController } from '@shared/lib/ipc/rpc';
import { mcpHttpServer } from './server/mcp-http-server';
import { isSelfServerEntry, resolveSelfServer } from './server/self-registration';
import { mcpService } from './services/McpService';
import { isManagedCatalogKey } from './utils/catalog';

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

/**
 * Managed entries carry the local bearer token in their Authorization header;
 * never send it to the renderer. The `managed` annotation tells the renderer
 * to treat the entry's connection details as read-only. An unrelated server
 * that happens to use a managed name is passed through untouched.
 */
function redactManagedServer(server: McpServer): McpServer {
  if (!isManagedCatalogKey(server.name) || !isSelfServerEntry(server)) return server;
  return { ...server, headers: undefined, managed: true };
}

/**
 * The managed emdash entry's connection details come from the live server,
 * not the caller — callers only choose providers. But only when the entry is
 * actually ours: a user's own server that happens to use the managed name,
 * whether already installed or newly submitted with its own URL, is saved
 * as-is instead of being overwritten with loopback connection details.
 */
async function resolveServerForSave(server: McpServer): Promise<McpServer> {
  if (!isManagedCatalogKey(server.name)) return server;
  const { installed } = await mcpService.loadAll();
  const existing = installed.find((entry) => entry.name === server.name);
  if (existing && !isSelfServerEntry(existing)) return server;
  if (!existing && server.url && !isSelfServerEntry(server)) return server;
  // Spread the existing entry first so user-set fields (enabled, timeout,
  // cwd) survive; connection details are always replaced.
  return { ...existing, ...resolveSelfServer(server.providers) };
}

export const mcpController = createRPCController({
  loadAll: async () => {
    try {
      const data = await mcpService.loadAll();
      const installed = data.installed.map(redactManagedServer);
      // Managed entries are only offered while the local server is running,
      // and their static catalog config has no URL — fill in the live address.
      const info = mcpHttpServer.getConnectionInfo();
      const catalog = data.catalog.flatMap((entry) => {
        if (!entry.managed) return [entry];
        if (!info) return [];
        return [{ ...entry, defaultConfig: { ...entry.defaultConfig, url: info.url } }];
      });
      return { success: true, data: { installed, catalog } };
    } catch (error) {
      log.error('Failed to load MCP servers:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  saveServer: async (server: McpServer) => {
    try {
      await mcpService.saveServer(await resolveServerForSave(server));
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
      return { success: true, data: mapProviders() };
    } catch (error) {
      log.error('Failed to get MCP providers:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  refreshProviders: async () => {
    try {
      await localDependencyManager.probeCategory('agent');
      return { success: true, data: mapProviders() };
    } catch (error) {
      log.error('Failed to refresh MCP providers:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  listForAgent: async (agentId: string) => {
    try {
      const data = await mcpService.listForAgent(agentId);
      return { success: true, data: data.map(redactManagedServer) };
    } catch (error) {
      log.error('Failed to list MCP servers for agent:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
});
