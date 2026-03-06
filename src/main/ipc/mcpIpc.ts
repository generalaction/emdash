import { ipcMain } from 'electron';
import { mcpService } from '../services/McpService';
import { getAllMcpAgentIds, agentSupportsHttp } from '../services/mcp/configPaths';
import { log } from '../lib/logger';
import type { McpServer, McpProvidersResponse } from '@shared/mcp/types';
import { PROVIDERS } from '@shared/providers/registry';
import { providerStatusCache } from '../services/providerStatusCache';
import { connectionsService } from '../services/ConnectionsService';

function mapProviders(agentIds: string[]): McpProvidersResponse[] {
  const statuses = providerStatusCache.getAll();
  return agentIds.map((id) => {
    const provider = PROVIDERS.find((p) => p.id === id);
    return {
      id,
      name: provider?.name ?? id,
      installed: statuses[id]?.installed ?? false,
      supportsHttp: agentSupportsHttp(id),
    };
  });
}

export function registerMcpIpc(): void {
  ipcMain.handle('mcp:load-all', async () => {
    try {
      const data = await mcpService.loadAll();
      return { success: true, data };
    } catch (error) {
      log.error('Failed to load MCP servers:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('mcp:save-server', async (_event, server: McpServer) => {
    try {
      await mcpService.saveServer(server);
      return { success: true };
    } catch (error) {
      log.error('Failed to save MCP server:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('mcp:remove-server', async (_event, serverName: string) => {
    try {
      await mcpService.removeServer(serverName);
      return { success: true };
    } catch (error) {
      log.error('Failed to remove MCP server:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('mcp:get-providers', async () => {
    try {
      return { success: true, data: mapProviders(getAllMcpAgentIds()) };
    } catch (error) {
      log.error('Failed to get MCP providers:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('mcp:refresh-providers', async () => {
    try {
      await connectionsService.refreshAllProviderStatuses();
      return { success: true, data: mapProviders(getAllMcpAgentIds()) };
    } catch (error) {
      log.error('Failed to refresh MCP providers:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
