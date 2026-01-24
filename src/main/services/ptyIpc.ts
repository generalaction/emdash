import { app, ipcMain, WebContents, BrowserWindow, Notification } from 'electron';
import {
  startPty,
  writePty,
  resizePty,
  killPty,
  getPty,
  startDirectPty,
  getSpawnBenchmarks,
  setOnDirectCliExit,
} from './ptyManager';
import { log } from '../lib/logger';
import { terminalSnapshotService } from './TerminalSnapshotService';
import { errorTracking } from '../errorTracking';
import type { TerminalSnapshotPayload } from '../types/terminalSnapshot';
import { getAppSettings } from '../settings';
import * as telemetry from '../telemetry';
import { PROVIDER_IDS, getProvider, type ProviderId } from '../../shared/providers/registry';
import { detectAndLoadTerminalConfig } from './TerminalConfigParser';
import { databaseService } from './DatabaseService';

const owners = new Map<string, WebContents>();
const listeners = new Set<string>();
const providerPtyTimers = new Map<string, number>();

// Guard IPC sends to prevent crashes when WebContents is destroyed
function safeSendToOwner(id: string, channel: string, payload: unknown): boolean {
  const wc = owners.get(id);
  if (!wc) return false;
  try {
    if (typeof wc.isDestroyed === 'function' && wc.isDestroyed()) return false;
    wc.send(channel, payload);
    return true;
  } catch (err) {
    log.warn('ptyIpc:safeSendFailed', {
      id,
      channel,
      error: String((err as Error)?.message || err),
    });
    return false;
  }
}

export function registerPtyIpc(): void {
  // When a direct-spawned CLI exits, spawn a shell so user can continue working
  setOnDirectCliExit(async (id: string, cwd: string) => {
    const wc = owners.get(id);
    if (!wc) return;

    try {
      // Spawn a shell in the same terminal
      const proc = await startPty({
        id,
        cwd,
        cols: 120,
        rows: 32,
      });

      if (!proc) {
        log.warn('ptyIpc: Failed to spawn shell after CLI exit', { id });
        killPty(id); // Clean up dead PTY record
        return;
      }

      // Re-attach listeners for the new shell process
      listeners.delete(id); // Clear old listener registration
      if (!listeners.has(id)) {
        proc.onData((data) => {
          owners.get(id)?.send(`pty:data:${id}`, data);
        });

        proc.onExit(({ exitCode, signal }) => {
          owners.get(id)?.send(`pty:exit:${id}`, { exitCode, signal });
          owners.delete(id);
          listeners.delete(id);
        });
        listeners.add(id);
      }

      // Notify renderer that shell is ready (reuse pty:started so existing listener handles it)
      if (!wc.isDestroyed()) {
        wc.send('pty:started', { id });
      }
      log.info('ptyIpc: Spawned shell after CLI exit', { id, cwd });
    } catch (err) {
      log.error('ptyIpc: Error spawning shell after CLI exit', { id, error: err });
      killPty(id); // Clean up dead PTY record
    }
  });

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
      const ptyStartTime = performance.now();
      if (process.env.EMDASH_DISABLE_PTY === '1') {
        return { ok: false, error: 'PTY disabled via EMDASH_DISABLE_PTY=1' };
      }
      try {
        const { id, cwd, shell, env, cols, rows, autoApprove, initialPrompt, skipResume } = args;
        const existing = getPty(id);

        // Determine if we should skip resume
        let shouldSkipResume = skipResume;

        // Check if this is an additional (non-main) chat
        // Additional chats should always skip resume as they don't have persistence
        const isAdditionalChat = id.includes('-chat-') && !id.includes('-main-');

        if (isAdditionalChat) {
          // Additional chats always start fresh (no resume)
          shouldSkipResume = true;
        } else if (shouldSkipResume === undefined) {
          // For main chats, check if this is a first-time start
          // For Claude and similar providers, check if a session directory exists
          if (cwd && shell) {
            try {
              const fs = require('fs');
              const path = require('path');
              const os = require('os');
              const crypto = require('crypto');

              // Check if this is Claude by looking at the shell
              const isClaudeOrSimilar = shell.includes('claude') || shell.includes('aider');

              if (isClaudeOrSimilar) {
                // Claude stores sessions in ~/.claude/projects/ with various naming schemes
                // Check both hash-based and path-based directory names
                const cwdHash = crypto.createHash('sha256').update(cwd).digest('hex').slice(0, 16);
                const claudeHashDir = path.join(os.homedir(), '.claude', 'projects', cwdHash);

                // Also check for path-based directory name (Claude's actual format)
                // Replace path separators with hyphens for the directory name
                const pathBasedName = cwd.replace(/\//g, '-');
                const claudePathDir = path.join(os.homedir(), '.claude', 'projects', pathBasedName);

                // Check if any Claude session directory exists for this working directory
                const projectsDir = path.join(os.homedir(), '.claude', 'projects');
                let sessionExists = false;

                // Check if the hash-based directory exists
                sessionExists = fs.existsSync(claudeHashDir);

                // If not, check for path-based directory
                if (!sessionExists) {
                  sessionExists = fs.existsSync(claudePathDir);
                }

                // If still not found, scan the projects directory for any matching directory
                if (!sessionExists && fs.existsSync(projectsDir)) {
                  try {
                    const dirs = fs.readdirSync(projectsDir);
                    // Check if any directory contains part of the working directory path
                    const cwdParts = cwd.split('/').filter((p) => p.length > 0);
                    const lastParts = cwdParts.slice(-3).join('-'); // Use last 3 parts of path
                    sessionExists = dirs.some((dir: string) => dir.includes(lastParts));
                  } catch (e) {
                    log.debug('pty:start error scanning Claude projects directory', { error: e });
                  }
                }

                // Skip resume if no session directory exists (new task)
                shouldSkipResume = !sessionExists;
              } else {
                // For other providers, default to not skipping (allow resume if supported)
                shouldSkipResume = false;
              }
            } catch (e) {
              // On error, default to not skipping
              shouldSkipResume = false;
            }
          } else {
            // If no cwd or shell, default to not skipping
            shouldSkipResume = false;
          }
        } else {
          // Use the explicitly provided value
          shouldSkipResume = shouldSkipResume || false;
        }

        const proc =
          existing ??
          (await startPty({
            id,
            cwd,
            shell,
            env,
            cols,
            rows,
            autoApprove,
            initialPrompt,
            skipResume: shouldSkipResume,
          }));
        const wc = event.sender;
        owners.set(id, wc);

        // Attach data/exit listeners once per PTY id
        if (!listeners.has(id)) {
          proc.onData((data) => {
            safeSendToOwner(id, `pty:data:${id}`, data);
          });

          proc.onExit(({ exitCode, signal }) => {
            // Check if this PTY is still active (not replaced by a newer instance)
            if (getPty(id) !== proc) {
              log.debug('pty:staleOnExit', { id });
              return;
            }
            safeSendToOwner(id, `pty:exit:${id}`, { exitCode, signal });
            maybeMarkProviderFinish(id, exitCode, signal);
            owners.delete(id);
            listeners.delete(id);
          });

          listeners.add(id);
        }

        // Clean up PTY when owner WebContents is destroyed (e.g., window closed)
        // Registered per-owner so ownership transfers are handled correctly
        wc.once('destroyed', () => {
          if (owners.get(id) !== wc) {
            log.debug('pty:staleOwnerDestroyed', { id });
            return;
          }
          log.debug('pty:ownerDestroyed', { id });
          try {
            // Ensure telemetry timers are cleared on owner destruction
            maybeMarkProviderFinish(id, null, undefined);
            killPty(id);
          } catch {}
          owners.delete(id);
          listeners.delete(id);
        });

        if (!existing) {
          maybeMarkProviderStart(id);
        }

        // Signal that PTY is ready so renderer may inject initial prompt safely
        try {
          const windows = BrowserWindow.getAllWindows();
          windows.forEach((w) => {
            try {
              if (!w.webContents.isDestroyed()) {
                w.webContents.send('pty:started', { id });
              }
            } catch {}
          });
        } catch {}

        return { ok: true };
      } catch (err: any) {
        log.error('pty:start FAIL', {
          id: args.id,
          cwd: args.cwd,
          shell: args.shell,
          error: err?.message || err,
        });

        // Track PTY start errors
        const parsed = parseProviderPty(args.id);
        await errorTracking.captureAgentSpawnError(
          err,
          parsed?.providerId || args.shell || 'unknown',
          parsed?.taskId || args.id,
          {
            cwd: args.cwd,
            autoApprove: args.autoApprove,
            hasInitialPrompt: !!args.initialPrompt,
          }
        );

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

  // Start a PTY by spawning CLI directly (no shell wrapper)
  // This is faster but falls back to shell-based spawn if CLI path unknown
  ipcMain.handle(
    'pty:startDirect',
    async (
      event,
      args: {
        id: string;
        providerId: string;
        cwd: string;
        cols?: number;
        rows?: number;
        autoApprove?: boolean;
        initialPrompt?: string;
        clickTime?: number;
        resume?: boolean;
      }
    ) => {
      if (process.env.EMDASH_DISABLE_PTY === '1') {
        return { ok: false, error: 'PTY disabled via EMDASH_DISABLE_PTY=1' };
      }

      try {
        const { id, providerId, cwd, cols, rows, autoApprove, initialPrompt, clickTime, resume } =
          args;
        const existing = getPty(id);

        if (existing) {
          const wc = event.sender;
          owners.set(id, wc);
          return { ok: true, reused: true };
        }

        const proc = startDirectPty({
          id,
          providerId,
          cwd,
          cols,
          rows,
          autoApprove,
          initialPrompt,
          clickTime,
          resume,
        });

        if (!proc) {
          return { ok: false, error: `CLI path not found for provider: ${providerId}` };
        }

        const wc = event.sender;
        owners.set(id, wc);

        if (!listeners.has(id)) {
          proc.onData((data) => {
            owners.get(id)?.send(`pty:data:${id}`, data);
          });

          proc.onExit(({ exitCode, signal }) => {
            owners.get(id)?.send(`pty:exit:${id}`, { exitCode, signal });
            maybeMarkProviderFinish(id, exitCode, signal);
            // DON'T delete owner/listeners - shell will be spawned and reuse them
            listeners.delete(id);
          });
          listeners.add(id);
        }

        // Clean up PTY when owner WebContents is destroyed (e.g., window closed)
        wc.once('destroyed', () => {
          if (owners.get(id) !== wc) {
            log.debug('pty:startDirect staleOwnerDestroyed', { id });
            return;
          }
          log.debug('pty:startDirect ownerDestroyed', { id });
          try {
            maybeMarkProviderFinish(id, null, undefined);
            killPty(id);
          } catch {}
          owners.delete(id);
          listeners.delete(id);
        });

        maybeMarkProviderStart(id);

        try {
          const windows = BrowserWindow.getAllWindows();
          windows.forEach((w: any) => w.webContents.send('pty:started', { id }));
        } catch {}

        return { ok: true };
      } catch (err: any) {
        log.error('pty:startDirect FAIL', { id: args.id, error: err?.message || err });
        return { ok: false, error: String(err?.message || err) };
      }
    }
  );

  // Get spawn benchmarks for performance analysis
  ipcMain.handle('pty:getBenchmarks', async () => {
    return { ok: true, benchmarks: getSpawnBenchmarks() };
  });
}

function parseProviderPty(id: string): {
  providerId: ProviderId;
  taskId: string;
} | null {
  // Chat terminals can be:
  // - `${provider}-main-${taskId}` for main task terminals
  // - `${provider}-chat-${conversationId}` for chat-specific terminals
  const mainMatch = /^([a-z0-9_-]+)-main-(.+)$/.exec(id);
  const chatMatch = /^([a-z0-9_-]+)-chat-(.+)$/.exec(id);

  const match = mainMatch || chatMatch;
  if (!match) return null;

  const providerId = match[1] as ProviderId;
  if (!PROVIDER_IDS.includes(providerId)) return null;

  const taskId = match[2]; // This is either taskId or conversationId
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

// Kill all PTYs on app shutdown to prevent crash loop
try {
  app.on('before-quit', () => {
    for (const id of Array.from(owners.keys())) {
      try {
        // Ensure telemetry timers are cleared on app quit
        maybeMarkProviderFinish(id, null, undefined);
        killPty(id);
      } catch {}
    }
    owners.clear();
    listeners.clear();
  });
} catch {}
