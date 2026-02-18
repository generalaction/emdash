import { app, ipcMain, WebContents, BrowserWindow, Notification } from 'electron';
import {
  startPty,
  writePty,
  resizePty,
  killPty,
  getPty,
  getPtyKind,
  startDirectPty,
  startSshPty,
  removePtyRecord,
  setOnDirectCliExit,
} from './ptyManager';
import { log } from '../lib/logger';
import { terminalSnapshotService } from './TerminalSnapshotService';
import { errorTracking } from '../errorTracking';
import type { TerminalSnapshotPayload } from '../types/terminalSnapshot';
import { getAppSettings } from '../settings';
import * as telemetry from '../telemetry';
import { PROVIDER_IDS, getProvider, type ProviderId } from '../../shared/providers/registry';
import { parsePtyId, isChatPty } from '../../shared/ptyId';
import { detectAndLoadTerminalConfig } from './TerminalConfigParser';
import { databaseService } from './DatabaseService';
import { getDrizzleClient } from '../db/drizzleClient';
import { sshConnections as sshConnectionsTable } from '../db/schema';
import { eq } from 'drizzle-orm';

const owners = new Map<string, WebContents>();
const listeners = new Set<string>();
const providerPtyTimers = new Map<string, number>();
// Map PTY IDs to provider IDs for multi-agent tracking
const ptyProviderMap = new Map<string, ProviderId>();
// Prevent duplicate finish handling when cleanup and onExit race for the same PTY.
const finalizedPtys = new Set<string>();
// Track WebContents that have a 'destroyed' listener to avoid duplicates
const wcDestroyedListeners = new Set<number>();
let isAppQuitting = false;

type FinishCause = 'process_exit' | 'app_quit' | 'owner_destroyed' | 'manual_kill';

// Buffer PTY output to reduce IPC overhead (helps SSH feel less laggy)
const ptyDataBuffers = new Map<string, string>();
const ptyDataTimers = new Map<string, NodeJS.Timeout>();
const PTY_DATA_FLUSH_MS = 16;

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

function flushPtyData(id: string): void {
  const buf = ptyDataBuffers.get(id);
  if (!buf) return;
  ptyDataBuffers.delete(id);
  safeSendToOwner(id, `pty:data:${id}`, buf);
}

function clearPtyData(id: string): void {
  const t = ptyDataTimers.get(id);
  if (t) {
    clearTimeout(t);
    ptyDataTimers.delete(id);
  }
  ptyDataBuffers.delete(id);
}

function bufferedSendPtyData(id: string, chunk: string): void {
  const prev = ptyDataBuffers.get(id) || '';
  ptyDataBuffers.set(id, prev + chunk);
  if (ptyDataTimers.has(id)) return;
  const t = setTimeout(() => {
    ptyDataTimers.delete(id);
    flushPtyData(id);
  }, PTY_DATA_FLUSH_MS);
  ptyDataTimers.set(id, t);
}

function quoteShellArg(arg: string): string {
  return /[\s'"\\$`\n\r\t]/.test(arg) ? `'${arg.replace(/'/g, "'\\''")}'` : arg;
}

function escapeForDoubleQuotes(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildRemoteInitCommand(args: {
  cwd?: string;
  provider?: { cli: string; cmd: string; installCommand?: string };
}): string {
  const parts: string[] = [];
  if (args.cwd) {
    // Avoid `cd --` for maximum shell portability.
    parts.push(
      `cd ${quoteShellArg(args.cwd)} || echo "emdash: could not cd to ${escapeForDoubleQuotes(args.cwd)}"`
    );
  }
  if (args.provider) {
    const cli = args.provider.cli;
    const install = args.provider.installCommand ? ` Install: ${args.provider.installCommand}` : '';
    const msg = `emdash: ${cli} not found on remote.${install}`;
    parts.push(
      `if command -v ${quoteShellArg(cli)} >/dev/null 2>&1; then ${args.provider.cmd}; else echo "${escapeForDoubleQuotes(
        msg
      )}"; fi`
    );
  }

  // Launch an interactive session in the user's configured shell.
  // $SHELL is always set by sshd from the remote user's passwd entry.
  parts.push(`exec "\${SHELL:-/bin/bash}" -i`);

  return parts.join('; ');
}

async function resolveSshInvocation(
  connectionId: string
): Promise<{ target: string; args: string[] }> {
  // If created from ssh config selection, prefer using the alias so OpenSSH config
  // (ProxyJump, UseKeychain, etc.) is honored by system ssh.
  if (connectionId.startsWith('ssh-config:')) {
    const raw = connectionId.slice('ssh-config:'.length);
    let alias = raw;
    try {
      // New scheme uses encodeURIComponent.
      if (/%[0-9A-Fa-f]{2}/.test(raw)) {
        alias = decodeURIComponent(raw);
      }
    } catch {
      alias = raw;
    }
    if (alias) {
      return { target: alias, args: [] };
    }
  }

  const { db } = await getDrizzleClient();
  const rows = await db
    .select({
      id: sshConnectionsTable.id,
      host: sshConnectionsTable.host,
      port: sshConnectionsTable.port,
      username: sshConnectionsTable.username,
      privateKeyPath: sshConnectionsTable.privateKeyPath,
    })
    .from(sshConnectionsTable)
    .where(eq(sshConnectionsTable.id, connectionId))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new Error(`SSH connection not found: ${connectionId}`);
  }

  const args: string[] = [];
  if (row.port && row.port !== 22) {
    args.push('-p', String(row.port));
  }
  if (row.privateKeyPath) {
    args.push('-i', row.privateKeyPath);
  }

  const target = row.username ? `${row.username}@${row.host}` : row.host;
  return { target, args };
}

function buildRemoteProviderInvocation(args: {
  providerId: string;
  autoApprove?: boolean;
  initialPrompt?: string;
  resume?: boolean;
}): { cli: string; cmd: string; installCommand?: string } {
  const { providerId, autoApprove, initialPrompt, resume } = args;
  const provider = getProvider(providerId as ProviderId);

  const cliArgs: string[] = [];
  if (provider?.resumeFlag && resume) {
    cliArgs.push(...provider.resumeFlag.split(' '));
  }
  if (provider?.defaultArgs?.length) {
    cliArgs.push(...provider.defaultArgs);
  }
  if (autoApprove && provider?.autoApproveFlag) {
    cliArgs.push(provider.autoApproveFlag);
  }
  if (provider?.initialPromptFlag !== undefined && initialPrompt?.trim()) {
    if (provider.initialPromptFlag) {
      cliArgs.push(provider.initialPromptFlag);
    }
    cliArgs.push(initialPrompt.trim());
  }

  const cliCommand = provider?.cli || providerId.toLowerCase();
  const cmd =
    cliArgs.length > 0 ? `${cliCommand} ${cliArgs.map(quoteShellArg).join(' ')}` : cliCommand;

  return { cli: cliCommand, cmd, installCommand: provider?.installCommand };
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
          bufferedSendPtyData(id, data);
        });

        proc.onExit(({ exitCode, signal }) => {
          flushPtyData(id);
          clearPtyData(id);
          safeSendToOwner(id, `pty:exit:${id}`, { exitCode, signal });
          owners.delete(id);
          listeners.delete(id);
          removePtyRecord(id);
        });
        listeners.add(id);
      }

      // Notify renderer that shell is ready (reuse pty:started so existing listener handles it)
      if (!wc.isDestroyed()) {
        wc.send('pty:started', { id });
      }
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
        remote?: { connectionId: string };
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
        const { id, cwd, remote, shell, env, cols, rows, autoApprove, initialPrompt, skipResume } =
          args;
        const existing = getPty(id);

        // Remote PTY routing: run an interactive ssh session in a local PTY.
        if (remote?.connectionId) {
          const wc = event.sender;
          owners.set(id, wc);

          if (existing) {
            const kind = getPtyKind(id);
            if (kind === 'ssh') {
              return { ok: true, reused: true };
            }
            // Replace an existing local PTY with an SSH-backed PTY.
            try {
              killPty(id);
            } catch {}
            listeners.delete(id);
          }

          const ssh = await resolveSshInvocation(remote.connectionId);
          const remoteInitCommand = buildRemoteInitCommand({ cwd });
          const proc = startSshPty({
            id,
            target: ssh.target,
            sshArgs: ssh.args,
            remoteInitCommand,
            cols,
            rows,
            env,
          });

          if (!listeners.has(id)) {
            proc.onData((data) => {
              bufferedSendPtyData(id, data);
            });
            proc.onExit(({ exitCode, signal }) => {
              flushPtyData(id);
              clearPtyData(id);
              safeSendToOwner(id, `pty:exit:${id}`, { exitCode, signal });
              owners.delete(id);
              listeners.delete(id);
              removePtyRecord(id);
            });
            listeners.add(id);
          }

          try {
            const windows = BrowserWindow.getAllWindows();
            windows.forEach((w: any) => w.webContents.send('pty:started', { id }));
          } catch {}

          return { ok: true };
        }

        // Determine if we should skip resume
        let shouldSkipResume = skipResume;

        // Check if this is an additional (non-main) chat
        // Additional chats should always skip resume as they don't have persistence
        const isAdditionalChat = isChatPty(id);

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
                  } catch {
                    // Ignore scan errors
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
            bufferedSendPtyData(id, data);
          });

          proc.onExit(({ exitCode, signal }) => {
            flushPtyData(id);
            clearPtyData(id);
            // Check if this PTY is still active (not replaced by a newer instance)
            if (getPty(id) !== proc) {
              return;
            }
            safeSendToOwner(id, `pty:exit:${id}`, { exitCode, signal });
            maybeMarkProviderFinish(
              id,
              exitCode,
              signal,
              isAppQuitting ? 'app_quit' : 'process_exit'
            );
            owners.delete(id);
            listeners.delete(id);
            removePtyRecord(id);
          });

          listeners.add(id);
        }

        // Clean up all PTYs owned by this WebContents when it's destroyed
        // Only register once per WebContents to avoid MaxListenersExceededWarning
        if (!wcDestroyedListeners.has(wc.id)) {
          wcDestroyedListeners.add(wc.id);
          wc.once('destroyed', () => {
            wcDestroyedListeners.delete(wc.id);
            // Clean up all PTYs owned by this WebContents
            for (const [ptyId, owner] of owners.entries()) {
              if (owner === wc) {
                try {
                  maybeMarkProviderFinish(
                    ptyId,
                    null,
                    undefined,
                    isAppQuitting ? 'app_quit' : 'owner_destroyed'
                  );
                  killPty(ptyId);
                } catch {}
                owners.delete(ptyId);
                listeners.delete(ptyId);
              }
            }
          });
        }

        // Track agent start even when reusing PTY (happens after shell respawn)
        // This ensures subsequent agent runs in the same task are tracked
        maybeMarkProviderStart(id);

        // Signal that PTY is ready
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

      // Track prompts sent to agents (not shell terminals)
      // Only count Enter key presses for known agent PTYs
      if (args.data === '\r' || args.data === '\n') {
        // Check if this PTY is associated with an agent
        const providerId = ptyProviderMap.get(args.id) || parseProviderPty(args.id)?.providerId;

        if (providerId) {
          // This is an agent terminal, track the prompt
          telemetry.capture('agent_prompt_sent', {
            provider: providerId,
          });
        }
      }
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
      maybeMarkProviderFinish(args.id, null, undefined, 'manual_kill');
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
        remote?: { connectionId: string };
        cols?: number;
        rows?: number;
        autoApprove?: boolean;
        initialPrompt?: string;
        env?: Record<string, string>;
        resume?: boolean;
      }
    ) => {
      if (process.env.EMDASH_DISABLE_PTY === '1') {
        return { ok: false, error: 'PTY disabled via EMDASH_DISABLE_PTY=1' };
      }

      try {
        const { id, providerId, cwd, remote, cols, rows, autoApprove, initialPrompt, env, resume } =
          args;
        const existing = getPty(id);

        if (remote?.connectionId) {
          const wc = event.sender;
          owners.set(id, wc);

          if (existing) {
            const kind = getPtyKind(id);
            if (kind === 'ssh') {
              return { ok: true, reused: true };
            }
            try {
              killPty(id);
            } catch {}
            listeners.delete(id);
          }

          const ssh = await resolveSshInvocation(remote.connectionId);
          const remoteProvider = buildRemoteProviderInvocation({
            providerId,
            autoApprove,
            initialPrompt,
            resume,
          });
          const remoteInitCommand = buildRemoteInitCommand({
            cwd,
            provider: remoteProvider,
          });

          const proc = startSshPty({
            id,
            target: ssh.target,
            sshArgs: ssh.args,
            remoteInitCommand,
            cols,
            rows,
            env,
          });

          if (!listeners.has(id)) {
            proc.onData((data) => {
              bufferedSendPtyData(id, data);
            });
            proc.onExit(({ exitCode, signal }) => {
              flushPtyData(id);
              clearPtyData(id);
              safeSendToOwner(id, `pty:exit:${id}`, { exitCode, signal });
              maybeMarkProviderFinish(id, exitCode, signal, 'process_exit');
              owners.delete(id);
              listeners.delete(id);
              removePtyRecord(id);
            });
            listeners.add(id);
          }

          maybeMarkProviderStart(id);
          try {
            const windows = BrowserWindow.getAllWindows();
            windows.forEach((w: any) => w.webContents.send('pty:started', { id }));
          } catch {}

          return { ok: true };
        }

        if (existing) {
          const wc = event.sender;
          owners.set(id, wc);
          // Still track agent start even when reusing PTY (happens after shell respawn)
          maybeMarkProviderStart(id, providerId as ProviderId);
          return { ok: true, reused: true };
        }

        let proc = startDirectPty({
          id,
          providerId,
          cwd,
          cols,
          rows,
          autoApprove,
          initialPrompt,
          env,
          resume,
        });

        // Fallback to shell-based spawn if direct spawn fails (CLI not in cache)
        // Track fallback so we know to clean up owners on exit (no shell respawn for fallback)
        let usedFallback = false;
        if (!proc) {
          const provider = getProvider(providerId as ProviderId);
          if (!provider?.cli) {
            return { ok: false, error: `CLI path not found for provider: ${providerId}` };
          }
          log.info('pty:startDirect - falling back to shell spawn', { id, providerId });
          proc = await startPty({
            id,
            cwd,
            shell: provider.cli,
            cols,
            rows,
            autoApprove,
            initialPrompt,
            env,
            skipResume: !resume,
          });
          usedFallback = true;
        }

        const wc = event.sender;
        owners.set(id, wc);

        if (!listeners.has(id)) {
          proc.onData((data) => {
            bufferedSendPtyData(id, data);
          });

          proc.onExit(({ exitCode, signal }) => {
            flushPtyData(id);
            clearPtyData(id);
            maybeMarkProviderFinish(
              id,
              exitCode,
              signal,
              isAppQuitting ? 'app_quit' : 'process_exit'
            );
            // Direct-spawn CLIs can be replaced immediately by a fallback shell after exit.
            // If this PTY has already been replaced, skip cleanup so we don't delete the new PTY record.
            const current = getPty(id);
            if (current && current !== proc) {
              return;
            }
            safeSendToOwner(id, `pty:exit:${id}`, { exitCode, signal });
            // For direct spawn: keep owner (shell respawn reuses it), delete listeners (shell respawn re-adds)
            // For fallback: clean up owner since no shell respawn happens
            if (usedFallback) {
              owners.delete(id);
            }
            listeners.delete(id);
            removePtyRecord(id);
          });
          listeners.add(id);
        }

        // Clean up all PTYs owned by this WebContents when it's destroyed
        // Only register once per WebContents to avoid MaxListenersExceededWarning
        if (!wcDestroyedListeners.has(wc.id)) {
          wcDestroyedListeners.add(wc.id);
          wc.once('destroyed', () => {
            wcDestroyedListeners.delete(wc.id);
            for (const [ptyId, owner] of owners.entries()) {
              if (owner === wc) {
                try {
                  maybeMarkProviderFinish(
                    ptyId,
                    null,
                    undefined,
                    isAppQuitting ? 'app_quit' : 'owner_destroyed'
                  );
                  killPty(ptyId);
                } catch {}
                owners.delete(ptyId);
                listeners.delete(ptyId);
              }
            }
          });
        }

        maybeMarkProviderStart(id, providerId as ProviderId);

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
}

function parseProviderPty(id: string): {
  providerId: ProviderId;
  taskId: string;
} | null {
  const parsed = parsePtyId(id);
  if (!parsed) return null;
  return { providerId: parsed.providerId, taskId: parsed.suffix };
}

function providerRunKey(providerId: ProviderId, taskId: string) {
  return `${providerId}:${taskId}`;
}

function maybeMarkProviderStart(id: string, providerId?: ProviderId) {
  finalizedPtys.delete(id);

  // First check if we have a direct provider ID (for multi-agent mode)
  if (providerId && PROVIDER_IDS.includes(providerId)) {
    ptyProviderMap.set(id, providerId);
    const key = `${providerId}:${id}`;
    if (providerPtyTimers.has(key)) return;
    providerPtyTimers.set(key, Date.now());
    telemetry.capture('agent_run_start', { provider: providerId });
    return;
  }

  // Check if we have a stored mapping (for subsequent calls)
  const storedProvider = ptyProviderMap.get(id);
  if (storedProvider) {
    const key = `${storedProvider}:${id}`;
    if (providerPtyTimers.has(key)) return;
    providerPtyTimers.set(key, Date.now());
    telemetry.capture('agent_run_start', { provider: storedProvider });
    return;
  }

  // Fall back to parsing the ID (single-agent mode)
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
  signal: number | undefined,
  cause: FinishCause
) {
  if (finalizedPtys.has(id)) return;
  finalizedPtys.add(id);

  let providerId: ProviderId | undefined;
  let key: string;

  // First check if we have a stored mapping (multi-agent mode)
  const storedProvider = ptyProviderMap.get(id);
  if (storedProvider) {
    providerId = storedProvider;
    key = `${storedProvider}:${id}`;
  } else {
    // Fall back to parsing the ID (single-agent mode)
    const parsed = parseProviderPty(id);
    if (!parsed) return;
    providerId = parsed.providerId;
    key = providerRunKey(parsed.providerId, parsed.taskId);
  }

  const started = providerPtyTimers.get(key);
  providerPtyTimers.delete(key);

  // Clean up the provider mapping
  ptyProviderMap.delete(id);

  // No valid exit code means the process was killed during cleanup, not a real completion
  if (typeof exitCode !== 'number') return;

  const duration = started ? Math.max(0, Date.now() - started) : undefined;
  const wasSignaled = signal !== undefined && signal !== null;
  const outcome = exitCode !== 0 && !wasSignaled ? 'error' : 'ok';

  telemetry.capture('agent_run_finish', {
    provider: providerId,
    outcome,
    duration_ms: duration,
  });

  if (cause === 'process_exit' && exitCode === 0) {
    const providerName = getProvider(providerId)?.name ?? providerId;
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
    isAppQuitting = true;
    for (const id of Array.from(owners.keys())) {
      try {
        // Ensure telemetry timers are cleared on app quit
        maybeMarkProviderFinish(id, null, undefined, 'app_quit');
        killPty(id);
      } catch {}
    }
    owners.clear();
    listeners.clear();
  });
} catch {}
