import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { app, ipcMain } from 'electron';
import { db } from '@/db/client';
import { ptyStartedChannel, shellSessionStartedChannel } from '@shared/events/appEvents';
import { errorTracking } from '../../_new/error-tracking';
import { createRPCController } from '../../../shared/ipc/rpc';
import { getProvider, PROVIDER_IDS, type ProviderId } from '../../../shared/providers/registry';
import { parsePtyId } from '../../../shared/ptyId';
import { sshConnections as sshConnectionsTable } from '../../db/schema';
import { events } from '../../lib/events';
import { log } from '../../lib/logger';
import * as telemetry from '../../lib/telemetry';
import type { TerminalSnapshotPayload } from '../types/terminalSnapshot';
import { quoteShellArg } from '../utils/shellEscape';
import { maybeAutoTrustForClaude } from './ClaudeConfigService';
import { ClaudeHookService } from './ClaudeHookService';
import { databaseService } from './DatabaseService';
import { lifecycleScriptsService } from './LifecycleScriptsService';
import { listeners, owners } from './ptyCleanup';
import {
  buildProviderCliArgs,
  claudeSessionFileExists,
  getPty,
  getPtyKind,
  getPtyTmuxSessionName,
  getTmuxSessionName,
  killPty,
  killTmuxSession,
  parseShellArgs,
  removePtyRecord,
  resizePty,
  resolveProviderCommandConfig,
  setOnDirectCliExit,
  startDirectPty,
  startPty,
  startSshPty,
  writePty,
} from './ptyManager';
import { detectAndLoadTerminalConfig } from './TerminalConfigParser';
import { terminalSnapshotService } from './TerminalSnapshotService';

// ---------------------------------------------------------------------------
// Session isolation — resolve CLI args from the conversations table.
// ptyManager.ts is a pure spawner; all DB reads/writes happen here.
// ---------------------------------------------------------------------------

/**
 * Resolves session isolation CLI args for a provider that supports --session-id.
 * Reads/writes `agentSessionId` on the conversations row in SQLite.
 * Returns an empty array for providers without sessionIdFlag.
 */
async function resolveSessionArgs(
  conversationId: string,
  provider: import('@shared/providers/registry').ProviderDefinition,
  cwd: string
): Promise<string[]> {
  if (!provider.sessionIdFlag) return [];
  const conv = await databaseService.getConversationById(conversationId);
  if (!conv) return [];
  if (conv.agentSessionId && claudeSessionFileExists(conv.agentSessionId, cwd)) {
    return ['--resume', conv.agentSessionId];
  }
  const uuid = randomUUID();
  await databaseService.updateConversationSessionId(conversationId, uuid);
  return [provider.sessionIdFlag, uuid];
}

// ---------------------------------------------------------------------------

const providerPtyTimers = new Map<string, number>();
// Map PTY IDs to provider IDs for multi-agent tracking
const ptyProviderMap = new Map<string, ProviderId>();
// Prevent duplicate finish handling when cleanup and onExit race for the same PTY.
const finalizedPtys = new Set<string>();
// Track WebContents that have a 'destroyed' listener to avoid duplicates
const wcDestroyedListeners = new Set<number>();

// type FinishCause = 'process_exit' | 'app_quit' | 'owner_destroyed' | 'manual_kill';

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
  safeSendToOwner(id, `pty:data.${id}`, buf);
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

function buildRemoteInitKeystrokes(args: {
  cwd?: string;
  provider?: { cli: string; cmd: string; installCommand?: string };
  tmux?: { sessionName: string };
}): string {
  const lines: string[] = [];
  if (args.cwd) {
    // Keep this line shell-agnostic (works in zsh/bash/fish); avoid POSIX `||` which fish doesn't support.
    // If `cd` fails, the shell will print its own error message.
    lines.push(`cd ${quoteShellArg(args.cwd)}`);
  }
  if (args.provider) {
    const cli = args.provider.cli;
    const install = args.provider.installCommand ? ` Install: ${args.provider.installCommand}` : '';
    const msg = `emdash: ${cli} not found on remote.${install}`;
    // Run the check inside a POSIX shell so it works even if the user's login shell isn't POSIX
    // (e.g. fish). PATH/env vars come from the interactive login shell started by `ssh`.

    if (args.tmux) {
      // When tmux is enabled, wrap the provider command in a named tmux session.
      // tmux new-session -As creates-or-attaches in one command.
      // Falls back to running without tmux if tmux isn't installed on the remote.
      const tmuxName = quoteShellArg(args.tmux.sessionName);
      const shScript = `if command -v ${quoteShellArg(cli)} >/dev/null 2>&1; then if command -v tmux >/dev/null 2>&1; then exec tmux new-session -As ${tmuxName} -- sh -c ${quoteShellArg(args.provider.cmd)}; else printf '%s\\n' 'emdash: tmux not found on remote, running without session persistence'; exec ${args.provider.cmd}; fi; else printf '%s\\n' ${quoteShellArg(
        msg
      )}; fi`;
      lines.push(`sh -c ${quoteShellArg(shScript)}`);
    } else {
      const shScript = `if command -v ${quoteShellArg(cli)} >/dev/null 2>&1; then exec ${args.provider.cmd}; else printf '%s\\n' ${quoteShellArg(
        msg
      )}; fi`;
      lines.push(`sh -c ${quoteShellArg(shScript)}`);
    }
  }

  return lines.length ? `${lines.join('\n')}\n` : '';
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
  const fallbackProvider = getProvider(providerId as ProviderId);
  const resolvedConfig = resolveProviderCommandConfig(providerId);
  const provider = resolvedConfig?.provider ?? fallbackProvider;

  const cliCommand = (
    resolvedConfig?.cli ||
    fallbackProvider?.cli ||
    providerId.toLowerCase()
  ).trim();
  const parsedCliParts = parseShellArgs(cliCommand);
  const cliCommandParts = parsedCliParts.length > 0 ? parsedCliParts : [cliCommand];
  const cliCheckCommand = cliCommandParts[0];

  const cliArgs = buildProviderCliArgs({
    resume,
    resumeFlag: resolvedConfig?.resumeFlag ?? fallbackProvider?.resumeFlag,
    defaultArgs: resolvedConfig?.defaultArgs ?? fallbackProvider?.defaultArgs,
    extraArgs: resolvedConfig?.extraArgs,
    autoApprove,
    autoApproveFlag: resolvedConfig?.autoApproveFlag ?? fallbackProvider?.autoApproveFlag,
    initialPrompt,
    initialPromptFlag: resolvedConfig?.initialPromptFlag ?? fallbackProvider?.initialPromptFlag,
    useKeystrokeInjection: provider?.useKeystrokeInjection,
  });

  const cmdParts = [...cliCommandParts, ...cliArgs];
  const cmd = cmdParts.map(quoteShellArg).join(' ');

  return { cli: cliCheckCommand, cmd, installCommand: provider?.installCommand };
}

/** Convert SSH args to SCP-compatible args (e.g. `-p` port → `-P` port). */
function buildScpArgs(sshArgs: string[]): string[] {
  const scpArgs: string[] = [];
  for (let i = 0; i < sshArgs.length; i++) {
    if (sshArgs[i] === '-p' && i + 1 < sshArgs.length) {
      // scp uses -P (uppercase) for port
      scpArgs.push('-P', sshArgs[i + 1]);
      i++;
    } else if (
      (sshArgs[i] === '-i' || sshArgs[i] === '-o' || sshArgs[i] === '-F') &&
      i + 1 < sshArgs.length
    ) {
      scpArgs.push(sshArgs[i], sshArgs[i + 1]);
      i++;
    }
  }
  return scpArgs;
}

function execFileAsync(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 30_000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${cmd} failed: ${stderr || error.message}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

async function resolveShellSetup(cwd: string): Promise<string | undefined> {
  // Committed .emdash.json lives in the worktree itself
  const fromCwd = lifecycleScriptsService.getShellSetup(cwd);
  if (fromCwd) return fromCwd;
  // Uncommitted .emdash.json only exists in the project root — look it up via DB
  try {
    const task = await databaseService.getTaskByPath(cwd);
    const project = task ? await databaseService.getProjectById(task.projectId) : null;
    if (project?.path) return lifecycleScriptsService.getShellSetup(project.path) ?? undefined;
  } catch {}
  return undefined;
}

async function resolveTmuxEnabled(cwd: string): Promise<boolean> {
  if (lifecycleScriptsService.getTmuxEnabled(cwd)) return true;
  try {
    const task = await databaseService.getTaskByPath(cwd);
    const project = task ? await databaseService.getProjectById(task.projectId) : null;
    if (project?.path) return lifecycleScriptsService.getTmuxEnabled(project.path);
  } catch {}
  return false;
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
          safeSendToOwner(id, `pty:exit.${id}`, { exitCode, signal });
          owners.delete(id);
          listeners.delete(id);
          removePtyRecord(id);
        });
        listeners.add(id);
      }

      // Notify renderer that shell is ready (reuse pty:started so existing listener handles it)
      if (!wc.isDestroyed()) {
        events.emit(ptyStartedChannel, { id });
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
          const proc = startSshPty({
            id,
            target: ssh.target,
            sshArgs: ssh.args,
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
              safeSendToOwner(id, `pty:exit.${id}`, { exitCode, signal });
              owners.delete(id);
              listeners.delete(id);
              removePtyRecord(id);
            });
            listeners.add(id);
          }

          // Resolve tmux config from local project settings
          const remoteTmux = cwd ? await resolveTmuxEnabled(cwd) : false;
          const remoteTmuxOpt = remoteTmux ? { sessionName: getTmuxSessionName(id) } : undefined;

          const remoteInit = buildRemoteInitKeystrokes({ cwd, tmux: remoteTmuxOpt });
          if (remoteInit) {
            proc.write(remoteInit);
          }

          try {
            events.emit(ptyStartedChannel, { id });
          } catch {}

          return { ok: true, tmux: remoteTmux };
        }

        // Determine if we should skip resume.
        // Providers without per-session isolation (no sessionIdFlag) share directory-scoped state.
        // Always start fresh to avoid all conversations sharing one provider session.
        let shouldSkipResume = skipResume;
        {
          const _parsedForResume = parsePtyId(id);
          const _convProvider =
            _parsedForResume && _parsedForResume.providerId !== 'shell'
              ? getProvider(_parsedForResume.providerId)
              : null;
          if (!_convProvider?.sessionIdFlag) {
            shouldSkipResume = true;
          } else if (shouldSkipResume === undefined) {
            if (cwd && shell) {
              try {
                const isClaudeOrSimilar = shell.includes('claude') || shell.includes('aider');

                if (isClaudeOrSimilar) {
                  const cwdHash = createHash('sha256').update(cwd).digest('hex').slice(0, 16);
                  const claudeHashDir = path.join(os.homedir(), '.claude', 'projects', cwdHash);
                  const pathBasedName = cwd.replace(/\//g, '-');
                  const claudePathDir = path.join(
                    os.homedir(),
                    '.claude',
                    'projects',
                    pathBasedName
                  );
                  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
                  let sessionExists = fs.existsSync(claudeHashDir);
                  if (!sessionExists) sessionExists = fs.existsSync(claudePathDir);
                  if (!sessionExists && fs.existsSync(projectsDir)) {
                    try {
                      const dirs = fs.readdirSync(projectsDir);
                      const cwdParts = cwd.split('/').filter((p: string) => p.length > 0);
                      const lastParts = cwdParts.slice(-3).join('-');
                      sessionExists = dirs.some((dir: string) => dir.includes(lastParts));
                    } catch {
                      // Ignore scan errors
                    }
                  }
                  shouldSkipResume = !sessionExists;
                } else {
                  shouldSkipResume = false;
                }
              } catch {
                shouldSkipResume = false;
              }
            } else {
              shouldSkipResume = false;
            }
          } else {
            shouldSkipResume = shouldSkipResume || false;
          }
        }

        const parsedPty = parsePtyId(id);
        if (parsedPty) maybeAutoTrustForClaude(parsedPty.providerId, cwd);

        const shellSetup = cwd ? await resolveShellSetup(cwd) : undefined;
        const tmux = cwd ? await resolveTmuxEnabled(cwd) : false;

        // Resolve session isolation args from DB (provider CLI args go in here).
        let sessionIsolationArgs: string[] = [];
        if (!shouldSkipResume && parsedPty) {
          const shellProvider = getProvider(parsedPty.providerId as ProviderId);
          if (shellProvider && cwd) {
            sessionIsolationArgs = await resolveSessionArgs(
              parsedPty.conversationId,
              shellProvider,
              cwd
            );
          }
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
            shellSetup,
            tmux,
            sessionIsolationArgs,
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
            safeSendToOwner(id, `pty:exit.${id}`, { exitCode, signal });
            maybeMarkProviderFinish(id, exitCode, signal);
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
                  maybeMarkProviderFinish(ptyId, null, undefined);
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
        events.emit(ptyStartedChannel, { id });

        return { ok: true, tmux };
      } catch (err) {
        log.error('pty:start FAIL', {
          id: args.id,
          cwd: args.cwd,
          shell: args.shell,
          error: err instanceof Error ? err.message : String(err),
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
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
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
      maybeMarkProviderFinish(args.id, null, undefined);
      // Kill associated tmux session if this PTY was tmux-wrapped
      if (getPtyTmuxSessionName(args.id)) {
        killTmuxSession(args.id);
      }
      killPty(args.id);
      owners.delete(args.id);
      listeners.delete(args.id);
    } catch (e) {
      log.error('pty:kill error', { id: args.id, error: e });
    }
  });

  // Kill a tmux session by PTY ID (used during task deletion cleanup)
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

          const resolvedConfig = resolveProviderCommandConfig(providerId);
          const mergedEnv = resolvedConfig?.env ? { ...resolvedConfig.env, ...env } : env;

          const proc = startSshPty({
            id,
            target: ssh.target,
            sshArgs: ssh.args,
            cols,
            rows,
            env: mergedEnv,
          });

          if (!listeners.has(id)) {
            proc.onData((data) => {
              bufferedSendPtyData(id, data);
            });
            proc.onExit(({ exitCode, signal }) => {
              flushPtyData(id);
              clearPtyData(id);
              safeSendToOwner(id, `pty:exit.${id}`, { exitCode, signal });
              maybeMarkProviderFinish(id, exitCode, signal);
              owners.delete(id);
              listeners.delete(id);
              removePtyRecord(id);
            });
            listeners.add(id);
          }

          // Resolve tmux config from local project settings
          const remoteTmux = cwd ? await resolveTmuxEnabled(cwd) : false;
          const tmuxOpt = remoteTmux ? { sessionName: getTmuxSessionName(id) } : undefined;

          const remoteInit = buildRemoteInitKeystrokes({
            cwd,
            provider: remoteProvider,
            tmux: tmuxOpt,
          });
          if (remoteInit) {
            proc.write(remoteInit);
          }

          maybeMarkProviderStart(id);
          try {
            events.emit(ptyStartedChannel, { id });
          } catch {}

          return { ok: true, tmux: remoteTmux };
        }

        if (existing) {
          const wc = event.sender;
          owners.set(id, wc);
          // Still track agent start even when reusing PTY (happens after shell respawn)
          maybeMarkProviderStart(id, providerId as ProviderId);
          return { ok: true, reused: true };
        }

        // Providers without per-session isolation would share the provider's directory-scoped
        // session across conversations — never resume in that case.
        let effectiveResume = resume;
        {
          const _parsedForDirect = parsePtyId(id);
          const _convProviderDirect = _parsedForDirect
            ? getProvider(_parsedForDirect.providerId as ProviderId)
            : getProvider(providerId as ProviderId);
          if (!_convProviderDirect?.sessionIdFlag) {
            effectiveResume = false;
          }
        }

        maybeAutoTrustForClaude(providerId, cwd);

        const shellSetup = await resolveShellSetup(cwd);
        const tmux = await resolveTmuxEnabled(cwd);

        // Write Claude Code hook config so it calls back to Emdash on events
        if (providerId === 'claude') {
          try {
            ClaudeHookService.writeHookConfig(cwd);
          } catch (err) {
            log.warn('pty:startDirect - failed to write Claude hook config', {
              error: String(err),
            });
          }
        }

        // Resolve session isolation args from the DB (no DB access in ptyManager).
        const providerDef = getProvider(providerId as ProviderId);
        const parsedId = parsePtyId(id);
        const sessionIsolationArgs =
          parsedId && providerDef
            ? await resolveSessionArgs(parsedId.conversationId, providerDef, cwd)
            : [];

        // Try direct spawn first; skip if shellSetup or tmux requires a shell wrapper
        const directProc =
          shellSetup || tmux
            ? null
            : startDirectPty({
                id,
                providerId,
                cwd,
                cols,
                rows,
                autoApprove,
                initialPrompt,
                env,
                resume: effectiveResume,
                tmux,
                sessionIsolationArgs,
              });

        // Fall back to shell-based spawn when direct spawn is unavailable or shellSetup/tmux is set
        let usedFallback = false;
        let proc: import('node-pty').IPty;
        if (directProc) {
          proc = directProc;
        } else {
          if (!providerDef?.cli) {
            return { ok: false, error: `CLI path not found for provider: ${providerId}` };
          }
          if (!shellSetup && !tmux)
            log.info('pty:startDirect - falling back to shell spawn', { id, providerId });
          proc = await startPty({
            id,
            cwd,
            shell: providerDef.cli,
            cols,
            rows,
            autoApprove,
            initialPrompt,
            env,
            skipResume: !resume,
            shellSetup,
            tmux,
            sessionIsolationArgs,
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
            maybeMarkProviderFinish(id, exitCode, signal);
            // Direct-spawn CLIs can be replaced immediately by a fallback shell after exit.
            // If this PTY has already been replaced, skip cleanup so we don't delete the new PTY record.
            const current = getPty(id);
            if (current && current !== proc) {
              return;
            }
            safeSendToOwner(id, `pty:exit.${id}`, { exitCode, signal });
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
                  maybeMarkProviderFinish(ptyId, null, undefined);
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
          events.emit(ptyStartedChannel, { id });
        } catch {}

        return { ok: true, tmux };
      } catch (err) {
        log.error('pty:startDirect FAIL', {
          id: args.id,
          error: err instanceof Error ? err.message : String(err),
        });
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );
}

export const ptyController = createRPCController({
  killTmux: async (args: { id: string }) => {
    try {
      killTmuxSession(args.id);
      return { ok: true };
    } catch (e) {
      log.error('pty:killTmux error', { id: args.id, error: e });
      return { ok: false, error: String(e) };
    }
  },

  snapshotGet: async (args: { id: string }) => {
    try {
      const snapshot = await terminalSnapshotService.getSnapshot(args.id);
      return { ok: true, snapshot };
    } catch (error: unknown) {
      log.error('pty:snapshot:get failed', { id: args.id, error });
      return { ok: false, error: (error as Error)?.message || String(error) };
    }
  },

  snapshotSave: async (args: { id: string; payload: TerminalSnapshotPayload }) => {
    const { id, payload } = args;
    const result = await terminalSnapshotService.saveSnapshot(id, payload);
    if (!result.ok) {
      log.warn('pty:snapshot:save failed', { id, error: result.error });
    }
    return result;
  },

  snapshotClear: async (args: { id: string }) => {
    await terminalSnapshotService.deleteSnapshot(args.id);
    return { ok: true };
  },

  terminalGetTheme: async () => {
    try {
      const config = detectAndLoadTerminalConfig();
      if (config) {
        return { ok: true, config };
      }
      return { ok: false, error: 'No terminal configuration found' };
    } catch (error: unknown) {
      log.error('terminal:getTheme failed', { error });
      return { ok: false, error: (error as Error)?.message || String(error) };
    }
  },

  scpToRemote: async (args: {
    connectionId: string;
    localPaths: string[];
  }): Promise<{ success: boolean; remotePaths?: string[]; error?: string }> => {
    try {
      const ssh = await resolveSshInvocation(args.connectionId);
      const scpArgs = buildScpArgs(ssh.args);
      const remoteDir = '/tmp/emdash-images';

      await execFileAsync('ssh', [...ssh.args, ssh.target, `mkdir -p ${remoteDir}`]);

      const remotePaths: string[] = [];
      for (const localPath of args.localPaths) {
        const remoteName = `${randomUUID()}-${path.basename(localPath)}`;
        const remotePath = `${remoteDir}/${remoteName}`;
        await execFileAsync('scp', [...scpArgs, localPath, `${ssh.target}:${remotePath}`]);
        remotePaths.push(remotePath);
      }

      return { success: true, remotePaths };
    } catch (err: unknown) {
      log.error('pty:scp-to-remote failed', {
        connectionId: args.connectionId,
        error: (err as Error)?.message || err,
      });
      return { success: false, error: String((err as Error)?.message || err) };
    }
  },
});

function parseProviderPty(id: string): {
  providerId: ProviderId;
  taskId: string;
} | null {
  const parsed = parsePtyId(id);
  if (!parsed || parsed.providerId === 'shell') return null;
  // conversationId is used as the telemetry key — we don't have a taskId here,
  // so we fall back to conversationId which is unique enough for telemetry dedup.
  return { providerId: parsed.providerId as ProviderId, taskId: parsed.conversationId };
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
  signal: number | undefined
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

// ---------------------------------------------------------------------------
// Shell session helper — spawns a standalone PTY for lifecycle scripts
// (setup, teardown, run/dev server).
//
// These sessions are NOT backed by a DB conversation record — they use a
// self-contained UUID sessionId.  The renderer connects by subscribing to
// shellSessionStartedChannel and using the emitted ptyId directly.
// ---------------------------------------------------------------------------

/**
 * Spawn a standalone PTY for a lifecycle script.
 * Wire up data buffering so the renderer terminal can receive output once it
 * connects, and call `onExit` when the process terminates.
 *
 * Returns the sessionId and ptyId so callers can track the session.
 * No database record is created.
 */
export async function startShellSession(args: {
  taskId: string;
  title: string;
  cwd: string;
  command: string;
  env?: NodeJS.ProcessEnv;
  onExit?: (exitCode: number | null) => void;
}): Promise<{ sessionId: string; ptyId: string }> {
  const sessionId = randomUUID();
  const ptyId = `lifecycle-${sessionId}`;

  const proc = await startPty({ id: ptyId, cwd: args.cwd, shell: args.command, env: args.env });

  if (!listeners.has(ptyId)) {
    proc.onData((data) => {
      bufferedSendPtyData(ptyId, data);
    });
    proc.onExit(({ exitCode }) => {
      flushPtyData(ptyId);
      clearPtyData(ptyId);
      safeSendToOwner(ptyId, `pty:exit.${ptyId}`, { exitCode });
      owners.delete(ptyId);
      listeners.delete(ptyId);
      removePtyRecord(ptyId);
      args.onExit?.(exitCode ?? null);
    });
    listeners.add(ptyId);
  }

  events.emit(shellSessionStartedChannel, {
    taskId: args.taskId,
    sessionId,
    ptyId,
    title: args.title,
  });
  return { sessionId, ptyId };
}
