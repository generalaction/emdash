import { AppSettingsUpdate, getAppSettings, updateAppSettings } from '../settings';
import { createRPCController } from '../../shared/ipc/rpc';
import { mcpTaskServer } from '../services/McpTaskServer';
import { log } from '../lib/logger';

export const appSettingsController = createRPCController({
  get: async () => getAppSettings(),
  update: async (partial: AppSettingsUpdate) => {
    const before = getAppSettings().mcp;
    const result = updateAppSettings(partial || {});
    const after = getAppSettings().mcp;

    const wasEnabled = before?.enabled ?? false;
    const isEnabled = after?.enabled ?? false;
    const portChanged = (before?.port ?? undefined) !== (after?.port ?? undefined);

    if (!wasEnabled && isEnabled) {
      try {
        await mcpTaskServer.start(after?.port);
      } catch (err) {
        log.warn('[settingsIpc] Failed to start MCP server', { error: String(err) });
      }
    } else if (wasEnabled && !isEnabled) {
      mcpTaskServer.stop();
    } else if (isEnabled && portChanged) {
      const prevPort = mcpTaskServer.getPort() || undefined;
      mcpTaskServer.stop();
      try {
        await mcpTaskServer.start(after?.port);
      } catch (err) {
        log.warn('[settingsIpc] Failed to restart MCP server on port change', {
          error: String(err),
        });
        // Best-effort: try to bring the server back up on the previous port
        try {
          await mcpTaskServer.start(prevPort);
        } catch {
          // ignore — server stays down
        }
      }
    }

    return result;
  },
});
