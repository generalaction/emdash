import { ipcMain, BrowserWindow } from 'electron';
import { log } from '../lib/logger';
import { agentService } from '../services/AgentService';
import { codexService } from '../services/CodexService';

export function registerAgentIpc() {
  // Installation check
  ipcMain.handle('agent:check-installation', async (_e, providerId: 'codex' | 'claude') => {
    try {
      const ok = await agentService.isInstalled(providerId);
      return { success: true, isInstalled: ok };
    } catch (e: any) {
      return { success: false, error: e?.message || String(e) };
    }
  });

  // Installation instructions
  ipcMain.handle(
    'agent:get-installation-instructions',
    async (_e, providerId: 'codex' | 'claude') => {
      try {
        const text = agentService.getInstallationInstructions(providerId);
        return { success: true, instructions: text };
      } catch (e: any) {
        return { success: false, error: e?.message || String(e) };
      }
    }
  );

  // Start streaming
  ipcMain.handle(
    'agent:send-message-stream',
    async (
      _e,
      args: {
        providerId: 'codex' | 'claude';
        workspaceId: string;
        worktreePath: string;
        message: string;
        conversationId?: string;
      }
    ) => {
      try {
        await agentService.startStream(args);
        return { success: true };
      } catch (e: any) {
        return { success: false, error: e?.message || String(e) };
      }
    }
  );

  // Stop streaming
  ipcMain.handle(
    'agent:stop-stream',
    async (_e, args: { providerId: 'codex' | 'claude'; workspaceId: string }) => {
      try {
        const ok = await agentService.stopStream(args.providerId, args.workspaceId);
        return { success: ok };
      } catch (e: any) {
        return { success: false, error: e?.message || String(e) };
      }
    }
  );

  // Bridge Codex native events to generic agent events so renderer can listen once
  codexService.on('codex:output', (data: any) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((w) => {
      try {
        w.webContents.send('agent:stream-output', { providerId: 'codex', ...data });
      } catch (e) {
        log.warn('agentIpc:broadcastFailed', { channel: 'agent:stream-output', error: e });
      }
    });
  });
  codexService.on('codex:error', (data: any) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((w) => {
      try {
        w.webContents.send('agent:stream-error', { providerId: 'codex', ...data });
      } catch (e) {
        log.warn('agentIpc:broadcastFailed', { channel: 'agent:stream-error', error: e });
      }
    });
  });
  codexService.on('codex:complete', (data: any) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((w) => {
      try {
        w.webContents.send('agent:stream-complete', { providerId: 'codex', ...data });
      } catch (e) {
        log.warn('agentIpc:broadcastFailed', { channel: 'agent:stream-complete', error: e });
      }
    });
  });

  // Forward AgentService events (Claude et al.)
  agentService.on('agent:output', (data: any) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((w) => {
      try {
        w.webContents.send('agent:stream-output', data);
      } catch (e) {
        log.warn('agentIpc:broadcastFailed', { channel: 'agent:stream-output', error: e });
      }
    });
  });
  agentService.on('agent:error', (data: any) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((w) => {
      try {
        w.webContents.send('agent:stream-error', data);
      } catch (e) {
        log.warn('agentIpc:broadcastFailed', { channel: 'agent:stream-error', error: e });
      }
    });
  });
  agentService.on('agent:complete', (data: any) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((w) => {
      try {
        w.webContents.send('agent:stream-complete', data);
      } catch (e) {
        log.warn('agentIpc:broadcastFailed', { channel: 'agent:stream-complete', error: e });
      }
    });
  });
}
