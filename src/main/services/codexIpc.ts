import { ipcMain } from 'electron';
import { log } from '../lib/logger';
import { codexService } from './CodexService';

export function setupCodexIpc() {
  // Check if Codex is installed
  ipcMain.handle('codex:check-installation', async () => {
    try {
      const isInstalled = await codexService.getInstallationStatus();
      return { success: true, isInstalled };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // Create a new agent for a workspace
  ipcMain.handle('codex:create-agent', async (event, workspaceId: string, worktreePath: string) => {
    try {
      const agent = await codexService.createAgent(workspaceId, worktreePath);
      return { success: true, agent };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // Send a message to Codex
  ipcMain.handle('codex:send-message', async (event, workspaceId: string, message: string) => {
    try {
      const response = await codexService.sendMessage(workspaceId, message);
      return { success: true, response };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // Send a message to Codex with streaming
  ipcMain.handle(
    'codex:send-message-stream',
    async (event, workspaceId: string, message: string, conversationId?: string) => {
      try {
        await codexService.sendMessageStream(workspaceId, message, conversationId);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  // Get current streaming tail for a workspace (if running)
  ipcMain.handle('codex:get-stream-tail', async (_event, workspaceId: string) => {
    try {
      const info = codexService.getStreamInfo(workspaceId);
      return { success: true, ...info };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('codex:stop-stream', async (event, workspaceId: string) => {
    try {
      log.debug('[codex:stop-stream] request received', workspaceId);
      const stopped = await codexService.stopMessageStream(workspaceId);
      log.debug('[codex:stop-stream] result', { workspaceId, stopped });
      return { success: stopped, stopped };
    } catch (error) {
      log.error('[codex:stop-stream] failed', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Get agent status
  ipcMain.handle('codex:get-agent-status', async (event, workspaceId: string) => {
    try {
      const agent = codexService.getAgentStatus(workspaceId);
      return { success: true, agent };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // Get all agents
  ipcMain.handle('codex:get-all-agents', async () => {
    try {
      const agents = codexService.getAllAgents();
      return { success: true, agents };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // Remove an agent
  ipcMain.handle('codex:remove-agent', async (event, workspaceId: string) => {
    try {
      const removed = codexService.removeAgent(workspaceId);
      return { success: true, removed };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // Get installation instructions
  ipcMain.handle('codex:get-installation-instructions', async () => {
    try {
      const instructions = codexService.getInstallationInstructions();
      return { success: true, instructions };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  // Set up event listeners for streaming
  codexService.on('codex:output', (data) => {
    // Broadcast to all renderer processes
    const windows = require('electron').BrowserWindow.getAllWindows();
    windows.forEach((window: any) => {
      try {
        window.webContents.send('codex:stream-output', data);
      } catch (e) {
        log.warn('[codexIpc] broadcast failed', e);
      }
    });
  });

  codexService.on('codex:error', (data) => {
    // Broadcast to all renderer processes
    const windows = require('electron').BrowserWindow.getAllWindows();
    windows.forEach((window: any) => {
      try {
        window.webContents.send('codex:stream-error', data);
      } catch (e) {
        log.warn('[codexIpc] broadcast failed', e);
      }
    });
  });

  codexService.on('codex:complete', (data) => {
    // Broadcast to all renderer processes
    const windows = require('electron').BrowserWindow.getAllWindows();
    windows.forEach((window: any) => {
      try {
        window.webContents.send('codex:stream-complete', data);
      } catch (e) {
        log.warn('[codexIpc] broadcast failed', e);
      }
    });
  });

  log.info('✅ Codex IPC handlers registered');
}
