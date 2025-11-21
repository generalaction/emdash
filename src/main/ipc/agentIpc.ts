import { ipcMain, BrowserWindow, Notification } from 'electron';
import { agentService, type ProviderId } from '../services/AgentService';
import { codexService } from '../services/CodexService';
import { getAppSettings } from '../settings';
import * as telemetry from '../telemetry';

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
    markAgentStart('codex', data?.workspaceId);
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
    markAgentFinish('codex', data?.workspaceId, 'error');
  });
  codexService.on('codex:complete', (data: any) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((w) =>
      w.webContents.send('agent:stream-complete', { providerId: 'codex', ...data })
    );
    showCompletionNotification('Codex');
    markAgentFinish('codex', data?.workspaceId, 'ok');
  });

  // Forward AgentService events (Claude et al.)
  agentService.on('agent:output', (data: any) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((w) => w.webContents.send('agent:stream-output', data));
  });
  agentService.on('agent:start', (data: any) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((w) => w.webContents.send('agent:stream-start', data));
    markAgentStart(data?.providerId as ProviderId | undefined, data?.workspaceId);
  });
  agentService.on('agent:error', (data: any) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((w) => w.webContents.send('agent:stream-error', data));
    markAgentFinish(data?.providerId as ProviderId | undefined, data?.workspaceId, 'error');
  });
  agentService.on('agent:complete', (data: any) => {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((w) => w.webContents.send('agent:stream-complete', data));
    const providerName = data.providerId === 'claude' ? 'Claude' : 'Agent';
    showCompletionNotification(providerName);
    markAgentFinish(data?.providerId as ProviderId | undefined, data?.workspaceId, 'ok');
  });
}

const agentRunTimers = new Map<string, number>();

function agentKey(providerId?: ProviderId, workspaceId?: string) {
  if (!providerId || !workspaceId) return null;
  return `${providerId}:${workspaceId}`;
}

function markAgentStart(providerId?: ProviderId, workspaceId?: string) {
  const key = agentKey(providerId, workspaceId);
  if (!key) return;
  agentRunTimers.set(key, Date.now());
  telemetry.capture('agent_run_start', { provider: providerId });
}

function markAgentFinish(
  providerId: ProviderId | undefined,
  workspaceId: string | undefined,
  outcome: 'ok' | 'error'
) {
  const key = agentKey(providerId, workspaceId);
  const started = key ? agentRunTimers.get(key) : undefined;
  if (key) agentRunTimers.delete(key);
  const duration = started ? Math.max(0, Date.now() - started) : undefined;
  telemetry.capture('agent_run_finish', {
    provider: providerId,
    outcome,
    duration_ms: duration,
  });
}
