import { app, BrowserWindow, ipcMain } from 'electron';
import { mcpTaskServer } from '../services/McpTaskServer';
import { log } from '../lib/logger';

export function registerMcpTaskIpc(): void {
  // Hint a new window to drain queued tasks once it's ready
  app.on('browser-window-created', (_, window) => {
    window.webContents.once('did-finish-load', () => {
      if (mcpTaskServer.hasPendingTasks()) {
        window.webContents.send('mcp:taskAvailable');
      }
    });
  });

  // Pull-based drain — renderer calls this when its listener is ready
  ipcMain.handle('mcp:drainTaskQueue', () => {
    const tasks = mcpTaskServer.drainQueue();
    if (tasks.length > 0) {
      log.info(`[MCP] Draining ${tasks.length} queued task request(s)`);
    }
    return { success: true, data: tasks };
  });

  // Expose server connection info to the renderer (for the settings UI)
  ipcMain.handle('mcp:getServerInfo', () => {
    const port = mcpTaskServer.getPort();
    if (!port) return { running: false };
    return {
      running: true,
      port,
      mcpUrl: `http://127.0.0.1:${port}/mcp`,
    };
  });
}
