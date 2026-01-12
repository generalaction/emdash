import { ipcMain, WebContents, BrowserWindow, Notification } from 'electron';
import { startPty, writePty, resizePty, killPty, getPty } from './ptyManager';
import { log } from '../lib/logger';
import { terminalSnapshotService } from './TerminalSnapshotService';
import type { TerminalSnapshotPayload } from '../types/terminalSnapshot';
import { getAppSettings } from '../settings';
import * as telemetry from '../telemetry';
import { PROVIDER_IDS, getProvider, type ProviderId } from '../../shared/providers/registry';
import { detectAndLoadTerminalConfig } from './TerminalConfigParser';

const owners = new Map<string, WebContents>();
const listeners = new Set<string>();
const providerPtyTimers = new Map<string, number>();

export function registerPtyIpc(): void {
  ipcMain.handle(
    'pty:start',
    async (
      event,
      args: {
        id: string;
        cwd?: string;
        shell?: string;
        env?: Record<string, string>;
        cols?: number;
        rows?: number;
        autoApprove?: boolean;
        initialPrompt?: string;
        skipResume?: boolean;
      }
    ) => {
      if (process.env.EMDASH_DISABLE_PTY === '1') {
        return { ok: false, error: 'PTY disabled via EMDASH_DISABLE_PTY=1' };
      }
      try {
        const { id, cwd, shell, env, cols, rows, autoApprove, initialPrompt, skipResume } = args;
        const existing = getPty(id);

        // Only use resume flag if there's actually a conversation history to resume
        let shouldSkipResume = skipResume || false;
        if (!existing && !skipResume && shell) {
          const parsed = parseProviderPty(id);
          if (parsed) {
            const provider = getProvider(parsed.providerId);
            if (provider?.resumeFlag) {
              // Check if snapshot exists before using resume flag
              try {
                const snapshot = await terminalSnapshotService.getSnapshot(id);
                if (!snapshot || !snapshot.data) {
                  log.info('ptyIpc:noSnapshot - skipping resume flag', { id });
                  shouldSkipResume = true;
                }
              } catch (err) {
                log.warn('ptyIpc:snapshotCheckFailed - skipping resume', { id, error: err });
                shouldSkipResume = true;
              }
            }
          }
        }

        const proc =
          existing ??
          startPty({
            id,
            cwd,
            shell,
            env,
            cols,
            rows,
            autoApprove,
            initialPrompt,
            skipResume: shouldSkipResume,
          });
        const envKeys = env ? Object.keys(env) : [];
        log.debug('pty:start OK', {
          id,
          cwd,
          shell,
          cols,
          rows,
          autoApprove,
          skipResume,
          reused: !!existing,
          envKeys,
        });
        const wc = event.sender;
        owners.set(id, wc);

        // Attach listeners once per PTY id
        if (!listeners.has(id)) {
          proc.onData((data) => {
            owners.get(id)?.send(`pty:data:${id}`, data);
          });

          proc.onExit(({ exitCode, signal }) => {
            owners.get(id)?.send(`pty:exit:${id}`, { exitCode, signal });
            maybeMarkProviderFinish(id, exitCode, signal);
            owners.delete(id);
            listeners.delete(id);
          });
          listeners.add(id);
        }

        if (!existing) {
          maybeMarkProviderStart(id);
        }

        // Signal that PTY is ready so renderer may inject initial prompt safely
        try {
          const { BrowserWindow } = require('electron');
          const windows = BrowserWindow.getAllWindows();
          windows.forEach((w: any) => w.webContents.send('pty:started', { id }));
        } catch {}

        return { ok: true };
      } catch (err: any) {
        log.error('pty:start FAIL', {
          id: args.id,
          cwd: args.cwd,
          shell: args.shell,
          error: err?.message || err,
        });
        return { ok: false, error: String(err?.message || err) };
      }
    }
  );

  ipcMain.on('pty:input', (_event, args: { id: string; data: string }) => {
    try {
      writePty(args.id, args.data);
    } catch (e) {
      log.error('pty:input error', { id: args.id, error: e });
    }
  });

  ipcMain.on('pty:resize', (_event, args: { id: string; cols: number; rows: number }) => {
    try {
      resizePty(args.id, args.cols, args.rows);
    } catch (e) {
      log.error('pty:resize error', { id: args.id, cols: args.cols, rows: args.rows, error: e });
    }
  });

  ipcMain.on('pty:kill', (_event, args: { id: string }) => {
    try {
      // Ensure telemetry timers are cleared even on manual kill
      maybeMarkProviderFinish(args.id, null, undefined);
      killPty(args.id);
      owners.delete(args.id);
      listeners.delete(args.id);
    } catch (e) {
      log.error('pty:kill error', { id: args.id, error: e });
    }
  });

  ipcMain.handle('pty:snapshot:get', async (_event, args: { id: string }) => {
    try {
      const snapshot = await terminalSnapshotService.getSnapshot(args.id);
      return { ok: true, snapshot };
    } catch (error: any) {
      log.error('pty:snapshot:get failed', { id: args.id, error });
      return { ok: false, error: error?.message || String(error) };
    }
  });

  ipcMain.handle(
    'pty:snapshot:save',
    async (_event, args: { id: string; payload: TerminalSnapshotPayload }) => {
      const { id, payload } = args;
      const result = await terminalSnapshotService.saveSnapshot(id, payload);
      if (!result.ok) {
        log.warn('pty:snapshot:save failed', { id, error: result.error });
      }
      return result;
    }
  );

  ipcMain.handle('pty:snapshot:clear', async (_event, args: { id: string }) => {
    await terminalSnapshotService.deleteSnapshot(args.id);
    return { ok: true };
  });

  ipcMain.handle('terminal:getTheme', async () => {
    try {
      const config = detectAndLoadTerminalConfig();
      if (config) {
        return { ok: true, config };
      }
      return { ok: false, error: 'No terminal configuration found' };
    } catch (error: any) {
      log.error('terminal:getTheme failed', { error });
      return { ok: false, error: error?.message || String(error) };
    }
  });
}

function parseProviderPty(id: string): {
  providerId: ProviderId;
  taskId: string;
} | null {
  // Chat terminals are named `${provider}-main-${taskId}`
  const match = /^([a-z0-9_-]+)-main-(.+)$/.exec(id);
  if (!match) return null;
  const providerId = match[1] as ProviderId;
  if (!PROVIDER_IDS.includes(providerId)) return null;
  const taskId = match[2];
  return { providerId, taskId };
}

function providerRunKey(providerId: ProviderId, taskId: string) {
  return `${providerId}:${taskId}`;
}

function maybeMarkProviderStart(id: string) {
  const parsed = parseProviderPty(id);
  if (!parsed) return;
  const key = providerRunKey(parsed.providerId, parsed.taskId);
  if (providerPtyTimers.has(key)) return;
  providerPtyTimers.set(key, Date.now());
  telemetry.capture('agent_run_start', { provider: parsed.providerId });
}

function maybeMarkProviderFinish(
  id: string,
  exitCode: number | null | undefined,
  signal: number | undefined
) {
  const parsed = parseProviderPty(id);
  if (!parsed) return;
  const key = providerRunKey(parsed.providerId, parsed.taskId);
  const started = providerPtyTimers.get(key);
  providerPtyTimers.delete(key);

  const duration = started ? Math.max(0, Date.now() - started) : undefined;
  const wasSignaled = signal !== undefined && signal !== null;
  const outcome = typeof exitCode === 'number' && exitCode !== 0 && !wasSignaled ? 'error' : 'ok';

  telemetry.capture('agent_run_finish', {
    provider: parsed.providerId,
    outcome,
    duration_ms: duration,
  });

  const providerName = getProvider(parsed.providerId)?.name ?? parsed.providerId;
  if (outcome === 'ok') {
    showCompletionNotification(providerName);
  }
}

/**
 * Show a system notification for provider completion.
 * Only shows if: notifications are enabled, supported, and app is not focused.
 */
function showCompletionNotification(providerName: string) {
  try {
    const settings = getAppSettings();

    if (!settings.notifications?.enabled) return;
    if (!Notification.isSupported()) return;

    const windows = BrowserWindow.getAllWindows();
    const anyFocused = windows.some((w) => w.isFocused());
    if (anyFocused) return;

    const notification = new Notification({
      title: `${providerName} Task Complete`,
      body: 'Your agent has finished working',
      silent: !settings.notifications?.sound,
    });
    notification.show();
  } catch (error) {
    log.warn('Failed to show completion notification', { error });
  }
}
