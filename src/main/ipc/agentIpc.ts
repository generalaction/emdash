import { ipcMain, BrowserWindow, Notification } from 'electron';
import { agentService } from '../services/AgentService';
import { codexService } from '../services/CodexService';
import { getAppSettings } from '../settings';

/**
 * Show a system notification for agent task completion.
 * Only shows if: notifications are enabled, supported, and app is not focused.
 */
function showCompletionNotification(providerName: string) {
  try {
    const settings = getAppSettings();

    // Check if notifications are enabled in settings
    if (!settings.notifications?.enabled) return;

    // Check platform support
    if (!Notification.isSupported()) return;

    // Don't notify if any window is focused (user can already see completion)
    const windows = BrowserWindow.getAllWindows();
    const anyFocused = windows.some((w) => w.isFocused());
    if (anyFocused) return;

    // Show notification
    const notification = new Notification({
      title: `${providerName} Task Complete`,
      body: 'Your agent has finished working',
      silent: !settings.notifications?.sound,
    });
    notification.show();
  } catch (error) {
    // Silently fail - notifications are not critical
    console.error('Failed to show notification:', error);
  }
}

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
        autoApprove?: boolean;
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
  codexService.on('codex:start', (data: any) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((w) =>
      w.webContents.send('agent:stream-start', { providerId: 'codex', ...data })
    );
  });
  codexService.on('codex:output', (data: any) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((w) =>
      w.webContents.send('agent:stream-output', { providerId: 'codex', ...data })
    );
  });
  codexService.on('codex:error', (data: any) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((w) =>
      w.webContents.send('agent:stream-error', { providerId: 'codex', ...data })
    );
  });
  codexService.on('codex:complete', (data: any) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((w) =>
      w.webContents.send('agent:stream-complete', { providerId: 'codex', ...data })
    );
    showCompletionNotification('Codex');
  });

  // Forward AgentService events (Claude et al.)
  agentService.on('agent:output', (data: any) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((w) => w.webContents.send('agent:stream-output', data));
  });
  agentService.on('agent:start', (data: any) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((w) => w.webContents.send('agent:stream-start', data));
  });
  agentService.on('agent:error', (data: any) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((w) => w.webContents.send('agent:stream-error', data));
  });
  agentService.on('agent:complete', (data: any) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((w) => w.webContents.send('agent:stream-complete', data));
    const providerName = data.providerId === 'claude' ? 'Claude' : 'Agent';
    showCompletionNotification(providerName);
  });
}
