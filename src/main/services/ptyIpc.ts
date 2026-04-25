import { app, ipcMain, WebContents, BrowserWindow } from 'electron';
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
  parseShellArgs,
  buildProviderCliArgs,
  getProviderRuntimeCliArgs,
  resolveProviderCommandConfig,
  killTmuxSession,
  getTmuxSessionName,
  getPtyTmuxSessionName,
  clearStoredSession,
  getStoredResumeTarget,
  markCodexSessionBound,
} from './ptyManager';
import { log } from '../lib/logger';
import { terminalSnapshotService } from './TerminalSnapshotService';
import { errorTracking } from '../errorTracking';
import type { TerminalSnapshotPayload } from '../types/terminalSnapshot';
import * as telemetry from '../telemetry';
import { PROVIDER_IDS, getProvider, type ProviderId } from '../../shared/providers/registry';
import { parsePtyId, isChatPty } from '../../shared/ptyId';
import { detectAndLoadTerminalConfig } from './TerminalConfigParser';
import { ClaudeHookService } from './ClaudeHookService';
import { databaseService } from './DatabaseService';
import { lifecycleScriptsService } from './LifecycleScriptsService';
import { taskLifecycleService } from './TaskLifecycleService';
import { maybeAutoTrustForClaude } from './ClaudeConfigService';
import { OpenCodeHookService, OPEN_CODE_PLUGIN_FILE } from './OpenCodeHookService';
import { getDrizzleClient } from '../db/drizzleClient';
import { sshConnections as sshConnectionsTable } from '../db/schema';
import { eq } from 'drizzle-orm';
import { execFile } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import path from 'path';
import { quoteShellArg } from '../utils/shellEscape';
import { agentEventService } from './AgentEventService';
import { codexSessionService } from './CodexSessionService';
import { waitForShellPrompt, type PromptWaitHandle } from '../utils/waitForShellPrompt';

const owners = new Map<string, WebContents>();
const listeners = new Set<string>();
const promptHandles = new Map<string, PromptWaitHandle[]>();

function cancelPromptHandles(id: string): void {
  const handles = promptHandles.get(id);
  if (handles) {
    for (const h of handles) h.cancel();
    promptHandles.delete(id);
  }
}

function waitForSshPromptThenWrite(
  id: string,
  proc: {
    onData: (cb: (data: string) => void) => { dispose: () => void };
    write: (data: string) => void;
  },
  data: string,
  label: string
): void {
  const handles = promptHandles.get(id) ?? [];
  promptHandles.set(id, handles);

  const handle = waitForShellPrompt({
    subscribe: (cb) => {
      const disposable = proc.onData(cb);
      return () => disposable.dispose();
    },
    write: (d) => {
      proc.write(d);
      promptHandles.delete(id);
    },
    data,
    onTimeout: () =>
      log.warn(`${label} SSH shell prompt not detected, writing init commands anyway`, { id }),
  });
  handles.push(handle);
}

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
const PTY_ACTIVITY_SAMPLE_CHARS = 8_192;

const CODEX_BIND_LOOKBACK_MS = 15_000;
const CODEX_BIND_TIMEOUT_MS = 20_000;
const CODEX_BIND_POLL_MS = 250;
const codexBindingQueues = new Map<string, Promise<void>>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pruneInvalidCodexResumeTarget(
  ptyId: string,
  cwd: string,
  resume?: boolean
): Promise<void> {
  if (!resume) return;

  const exactTarget = getStoredResumeTarget(ptyId, 'codex', cwd);
  if (!exactTarget) return;

  const valid = await codexSessionService.threadExistsForCwd(exactTarget, cwd);
  if (valid) return;

  clearStoredSession(ptyId);
  log.warn('ptyIpc: pruned stale Codex resume target', { ptyId, cwd, exactTarget });
}

async function bindCodexThreadForPty(ptyId: string, cwd: string, startedAt: number): Promise<void> {
  if (getStoredResumeTarget(ptyId, 'codex', cwd)) {
    log.info('ptyIpc: skipping Codex bind because PTY already has a stored target', {
      ptyId,
      cwd,
    });
    return;
  }

  const deadline = Date.now() + CODEX_BIND_TIMEOUT_MS;
  const since = startedAt - CODEX_BIND_LOOKBACK_MS;
  let attempts = 0;

  log.info('ptyIpc: starting Codex thread bind', {
    ptyId,
    cwd,
    startedAt,
    since,
    timeoutMs: CODEX_BIND_TIMEOUT_MS,
    lookbackMs: CODEX_BIND_LOOKBACK_MS,
  });

  const existingThread = await codexSessionService.findLatestThreadForCwd(cwd);
  if (existingThread) {
    markCodexSessionBound(ptyId, existingThread.id, cwd);
    log.info('ptyIpc: bound Codex PTY to existing exact-cwd thread', {
      ptyId,
      cwd,
      threadId: existingThread.id,
      updatedAt: existingThread.updatedAt,
    });
    return;
  }

  while (Date.now() <= deadline) {
    attempts += 1;
    const thread = await codexSessionService.findLatestRecentThreadForCwd(cwd, since);
    if (thread || attempts <= 3 || attempts % 10 === 0) {
      log.info('ptyIpc: Codex bind poll result', {
        ptyId,
        cwd,
        attempt: attempts,
        candidateThreadId: thread?.id ?? null,
        candidateUpdatedAt: thread?.updatedAt ?? null,
      });
    }
    if (thread) {
      markCodexSessionBound(ptyId, thread.id, cwd);
      log.info('ptyIpc: bound Codex PTY to thread', { ptyId, cwd, threadId: thread.id });
      return;
    }
    await sleep(CODEX_BIND_POLL_MS);
  }

  const latestThread = await codexSessionService.findLatestThreadForCwd(cwd);
  if (latestThread) {
    markCodexSessionBound(ptyId, latestThread.id, cwd);
    log.info('ptyIpc: bound Codex PTY to latest exact-cwd thread after polling timeout', {
      ptyId,
      cwd,
      attempts,
      threadId: latestThread.id,
      updatedAt: latestThread.updatedAt,
    });
    return;
  }

  log.info('ptyIpc: no Codex thread discovered for PTY', {
    ptyId,
    cwd,
    attempts,
    latestThreadId: null,
    latestThreadUpdatedAt: null,
    latestThreadCreatedAt: null,
    latestThreadArchived: null,
  });
}

function scheduleCodexThreadBinding(ptyId: string, cwd: string, startedAt: number): void {
  if (getStoredResumeTarget(ptyId, 'codex', cwd)) {
    log.info('ptyIpc: not scheduling Codex bind because exact target already exists', {
      ptyId,
      cwd,
    });
    return;
  }

  const queueKey = `codex:${cwd}`;
  const previous = codexBindingQueues.get(queueKey) ?? Promise.resolve();
  log.info('ptyIpc: scheduling Codex bind', {
    ptyId,
    cwd,
    queueKey,
    queuedBehindExistingBind: codexBindingQueues.has(queueKey),
  });
  const next = previous
    .catch(() => {})
    .then(() => bindCodexThreadForPty(ptyId, cwd, startedAt))
    .catch((error) => {
      log.warn('ptyIpc: failed to bind Codex thread', {
        ptyId,
        cwd,
        error: String(error),
      });
    })
    .finally(() => {
      if (codexBindingQueues.get(queueKey) === next) {
        codexBindingQueues.delete(queueKey);
      }
    });

  codexBindingQueues.set(queueKey, next);
}

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

function sendPtyExitGlobal(id: string): void {
  safeSendToOwner(id, 'pty:exit:global', { id });
}

function flushPtyData(id: string): void {
  const buf = ptyDataBuffers.get(id);
  if (!buf) return;
  ptyDataBuffers.delete(id);
  safeSendToOwner(id, `pty:data:${id}`, buf);
  safeSendToOwner(id, 'pty:activity', {
    id,
    chunk: buf.length <= PTY_ACTIVITY_SAMPLE_CHARS ? buf : buf.slice(-PTY_ACTIVITY_SAMPLE_CHARS),
  });
}

function clearPtyData(id: string): void {
  const t = ptyDataTimers.get(id);
  if (t) {
    clearTimeout(t);
    ptyDataTimers.delete(id);
  }
  ptyDataBuffers.delete(id);
}

function cleanupPtySession(id: string): void {
  // Ensure telemetry timers are cleared even on manual kill
  maybeMarkProviderFinish(id, null, undefined, 'manual_kill');
  sendPtyExitGlobal(id);
  // Kill associated tmux session if this PTY was tmux-wrapped
  if (getPtyTmuxSessionName(id)) {
    killTmuxSession(id);
  }
  killPty(id);
  owners.delete(id);
  listeners.delete(id);
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

/**
 * Deterministic port in the ephemeral range (49152–65535) derived from ptyId.
 * Used for the reverse SSH tunnel so the remote hook can reach the local
 * AgentEventService.
 */
function pickReverseTunnelPort(ptyId: string): number {
  const hash = createHash('sha256').update(ptyId).digest();
  const value = hash.readUInt16BE(0); // 0–65535
  return 49152 + (value % (65535 - 49152 + 1));
}

/**
 * Write `.claude/settings.local.json` on the remote with Notification and Stop
 * hook entries, merging with any existing content (same logic as
 * `ClaudeHookService.writeHookConfig` locally).
 *
 * Uses two ssh exec calls: one to read the existing file, one to write the
 * merged result.  This avoids terminal line-buffer corruption and preserves
 * user-defined settings and hooks.
 */
async function writeRemoteHookConfig(
  sshArgs: string[],
  sshTarget: string,
  cwd: string
): Promise<void> {
  const dir = `${cwd}/.claude`;
  const filePath = `${dir}/settings.local.json`;

  // Read existing config (if any) from the remote
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let existing: Record<string, any> = {};
  try {
    const { stdout } = await execFileAsync('ssh', [
      ...sshArgs,
      sshTarget,
      `cat ${quoteShellArg(filePath)} 2>/dev/null || echo '{}'`,
    ]);
    existing = JSON.parse(stdout.trim());
  } catch {
    // File doesn't exist, isn't valid JSON, or ssh failed — start fresh
  }

  ClaudeHookService.mergeHookEntries(existing);

  const json = JSON.stringify(existing, null, 2);
  await execFileAsync('ssh', [
    ...sshArgs,
    sshTarget,
    `mkdir -p ${quoteShellArg(dir)} && printf '%s\\n' ${quoteShellArg(json)} > ${quoteShellArg(filePath)}`,
  ]);
}

async function writeRemoteOpenCodePlugin(
  sshArgs: string[],
  sshTarget: string,
  ptyId: string
): Promise<string> {
  const configDir = OpenCodeHookService.getRemoteConfigDir(ptyId);
  const pluginsDir = `${configDir}/plugins`;
  const pluginPath = `${pluginsDir}/${OPEN_CODE_PLUGIN_FILE}`;
  const pluginSource = OpenCodeHookService.getPluginSource();

  await execFileAsync('ssh', [
    ...sshArgs,
    sshTarget,
    `mkdir -p "${pluginsDir}" && printf '%s\\n' ${quoteShellArg(pluginSource)} > "${pluginPath}"`,
  ]);

  return configDir;
}

/**
 * Builds a remote init command wrapped in `/bin/sh -c` so it works regardless
 * of the remote login shell (fish, csh, etc. can't parse POSIX `${VAR:-…}`).
 */
function buildRemoteInitShellCommand(cwd: string): string {
  const posixPayload = `cd ${quoteShellArg(cwd)} && exec "\${SHELL:-/bin/sh}" -il`;
  return `/bin/sh -c ${quoteShellArg(posixPayload)}`;
}

function buildRemoteInitKeystrokes(args: {
  cwd?: string;
  provider?: { cli: string; cmd: string; installCommand?: string };
  tmux?: { sessionName: string };
  preProviderCommands?: string[];
}): string {
  const lines: string[] = [];
  if (args.cwd) {
    // Keep this line shell-agnostic (works in zsh/bash/fish); avoid POSIX `||` which fish doesn't support.
    // If `cd` fails, the shell will print its own error message.
    lines.push(`cd ${quoteShellArg(args.cwd)}`);
  }

  // Insert any pre-provider setup commands (e.g. export statements for hook env vars)
  if (args.preProviderCommands?.length) {
    lines.push(...args.preProviderCommands);
  }

  if (args.provider) {
    const cli = args.provider.cli;
    const install = args.provider.installCommand ? ` Install: ${args.provider.installCommand}` : '';
    const msg = `emdash: ${cli} not found on remote.${install}`;
    const providerCmd = args.provider.cmd;

    if (args.tmux) {
      // When tmux is enabled, wrap the provider command in a named tmux session.
      // tmux new-session -As creates-or-attaches in one command.
      // Falls back to running without tmux if tmux isn't installed on the remote.
      const tmuxName = quoteShellArg(args.tmux.sessionName);
      const shScript = `if command -v ${quoteShellArg(cli)} >/dev/null 2>&1; then if command -v tmux >/dev/null 2>&1; then exec tmux new-session -As ${tmuxName} -- sh -c ${quoteShellArg(providerCmd)}; else printf '%s\\n' 'emdash: tmux not found on remote, running without session persistence'; exec ${providerCmd}; fi; else printf '%s\\n' ${quoteShellArg(
        msg
      )}; fi`;
      lines.push(`sh -ilc ${quoteShellArg(shScript)}`);
    } else {
      const shScript = `if command -v ${quoteShellArg(cli)} >/dev/null 2>&1; then exec ${providerCmd}; else printf '%s\\n' ${quoteShellArg(
        msg
      )}; fi`;
      lines.push(`sh -ilc ${quoteShellArg(shScript)}`);
    }
  } else if (args.tmux) {
    // tmux-only (no provider): wrap the shell in a named tmux session for persistence.
    // Falls back gracefully if tmux isn't installed on the remote.
    const tmuxName = quoteShellArg(args.tmux.sessionName);
    const shScript = `if command -v tmux >/dev/null 2>&1; then exec tmux new-session -As ${tmuxName}; else printf '%s\\n' 'emdash: tmux not found on remote, running without session persistence'; fi`;
    lines.push(`sh -ilc ${quoteShellArg(shScript)}`);
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
  cliArgs.push(...getProviderRuntimeCliArgs({ providerId, target: 'remote' }));

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

async function resolveRemoteTmuxEnabled(
  ssh: { target: string; args: string[] },
  cwd: string
): Promise<boolean> {
  try {
    // Build list of paths to check: cwd first, then project root if cwd is a worktree
    const paths = [cwd];
    const marker = '/.emdash/worktrees/';
    const markerIdx = cwd.indexOf(marker);
    if (markerIdx > 0) {
      paths.push(cwd.slice(0, markerIdx));
    }

    // Read all .emdash.json files in a single SSH exec to avoid multiple round trips
    const catParts = paths.map(
      (p) => `cat ${quoteShellArg(`${p}/.emdash.json`)} 2>/dev/null || echo '{}'`
    );
    const { stdout } = await execFileAsync('ssh', [
      ...ssh.args,
      ssh.target,
      catParts.join('; echo "---EMDASH_SEP---"; '),
    ]);

    const parts = stdout.split('---EMDASH_SEP---');
    for (const part of parts) {
      try {
        if (JSON.parse(part.trim())?.tmux === true) return true;
      } catch {}
    }
    return false;
  } catch {
    return false;
  }
}

export function registerPtyIpc(): void {
  // When a direct-spawned CLI exits, spawn a shell so user can continue working
  setOnDirectCliExit(async (id: string, cwd: string) => {
    const wc = owners.get(id);
    if (!wc) {
      // No owner — clean up since the ptyIpc onExit handler skipped
      // cleanup for direct spawns.
      removePtyRecord(id);
      return;
    }

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
        safeSendToOwner(id, `pty:exit:${id}`, { exitCode: 1, signal: undefined });
        sendPtyExitGlobal(id);
        owners.delete(id);
        listeners.delete(id);
        removePtyRecord(id);
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
          sendPtyExitGlobal(id);
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
      safeSendToOwner(id, `pty:exit:${id}`, { exitCode: 1, signal: undefined });
      sendPtyExitGlobal(id);
      owners.delete(id);
      listeners.delete(id);
      removePtyRecord(id);
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

          const remoteInitCommand = cwd ? buildRemoteInitShellCommand(cwd) : undefined;

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
              cancelPromptHandles(id);
              flushPtyData(id);
              clearPtyData(id);
              safeSendToOwner(id, `pty:exit:${id}`, { exitCode, signal });
              sendPtyExitGlobal(id);
              owners.delete(id);
              listeners.delete(id);
              removePtyRecord(id);
            });
            listeners.add(id);
          }

          // Resolve tmux config from remote .emdash.json.
          // Workspace-provisioned connections always use tmux for session persistence.
          const isWorkspaceConnection = remote.connectionId.startsWith('workspace-');
          const remoteTmux =
            isWorkspaceConnection || (cwd ? await resolveRemoteTmuxEnabled(ssh, cwd) : false);
          const remoteTmuxOpt = remoteTmux ? { sessionName: getTmuxSessionName(id) } : undefined;

          const remoteInit = buildRemoteInitKeystrokes({
            cwd,
            tmux: remoteTmuxOpt,
          });
          if (remoteInit) {
            waitForSshPromptThenWrite(id, proc, remoteInit, 'ptyIpc:start');
          }

          try {
            const windows = BrowserWindow.getAllWindows();
            windows.forEach((w: any) => w.webContents.send('pty:started', { id }));
          } catch {}

          return { ok: true, tmux: remoteTmux };
        }

        // Determine if we should skip resume
        let shouldSkipResume = skipResume;

        // Check if this is an additional (non-main) chat
        const isAdditionalChat = isChatPty(id);

        if (isAdditionalChat) {
          // Additional chats can resume if the provider supports per-session
          // isolation (via sessionIdFlag), since each chat gets its own
          // session UUID. Without session isolation, always start fresh to
          // avoid all chats sharing the provider's directory-scoped state.
          const parsed = parsePtyId(id);
          const chatProvider = parsed ? getProvider(parsed.providerId) : null;
          if (!chatProvider?.sessionIdFlag) {
            shouldSkipResume = true;
          }
          // Otherwise keep shouldSkipResume from the renderer (undefined or
          // explicitly set), which is based on whether a snapshot exists.
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

        const parsedPty = parsePtyId(id);
        if (parsedPty) maybeAutoTrustForClaude(parsedPty.providerId, cwd);

        // Wait for any in-flight setup script to finish before spawning the PTY.
        // Setup scripts (e.g. copying .claude/skills into the worktree) must complete
        // before the agent initializes, otherwise the copied files won't be picked up
        // in the first session.
        if (parsedPty?.kind === 'main') {
          await taskLifecycleService.awaitSetup(parsedPty.suffix);
        }

        const shellSetup = cwd ? await resolveShellSetup(cwd) : undefined;
        const tmux = cwd ? await resolveTmuxEnabled(cwd) : false;

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
            sendPtyExitGlobal(id);
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

        return { ok: true, tmux };
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
      cleanupPtySession(args.id);
    } catch (e) {
      log.error('pty:kill error', { id: args.id, error: e });
    }
  });

  ipcMain.handle(
    'pty:cleanupSessions',
    async (
      _event,
      args: { ids: string[]; clearSnapshots?: boolean; waitForSnapshots?: boolean }
    ): Promise<{
      ok: boolean;
      cleaned: number;
      failedIds: string[];
      snapshotClearQueued: boolean;
    }> => {
      const ids = Array.from(new Set((args?.ids || []).filter(Boolean)));
      const failedIds: string[] = [];

      for (const id of ids) {
        try {
          cleanupPtySession(id);
        } catch (error) {
          failedIds.push(id);
          log.error('pty:cleanupSessions kill error', { id, error });
        }
      }

      const clearSnapshots = args?.clearSnapshots === true;
      const waitForSnapshots = args?.waitForSnapshots === true;
      if (clearSnapshots) {
        const clearPromise = Promise.allSettled(
          ids.map(async (id) => {
            try {
              await terminalSnapshotService.deleteSnapshot(id);
            } catch {}
          })
        );

        if (waitForSnapshots) {
          await clearPromise;
        } else {
          void clearPromise;
        }
      }

      return {
        ok: failedIds.length === 0,
        cleaned: ids.length - failedIds.length,
        failedIds,
        snapshotClearQueued: clearSnapshots,
      };
    }
  );

  // Kill a tmux session by PTY ID (used during task deletion cleanup)
  ipcMain.handle('pty:killTmux', async (_event, args: { id: string }) => {
    try {
      killTmuxSession(args.id);
      return { ok: true };
    } catch (e) {
      log.error('pty:killTmux error', { id: args.id, error: e });
      return { ok: false, error: String(e) };
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

  // SCP file transfer to SSH remote (for file drop on SSH terminals)
  ipcMain.handle(
    'pty:scp-to-remote',
    async (
      _event,
      args: { connectionId: string; localPaths: string[] }
    ): Promise<{ success: boolean; remotePaths?: string[]; error?: string }> => {
      try {
        const ssh = await resolveSshInvocation(args.connectionId);
        const scpArgs = buildScpArgs(ssh.args);
        const remoteDir = '/tmp/emdash-images';

        // Ensure remote directory exists
        await execFileAsync('ssh', [...ssh.args, ssh.target, `mkdir -p ${remoteDir}`]);

        // Transfer each file individually so UUID-prefixed names avoid collisions
        // (batching into one scp call would lose uniqueness for same-named files)
        const remotePaths: string[] = [];
        for (const localPath of args.localPaths) {
          const remoteName = `${randomUUID()}-${path.basename(localPath)}`;
          const remotePath = `${remoteDir}/${remoteName}`;
          await execFileAsync('scp', [...scpArgs, localPath, `${ssh.target}:${remotePath}`]);
          remotePaths.push(remotePath);
        }

        return { success: true, remotePaths };
      } catch (err: any) {
        log.error('pty:scp-to-remote failed', {
          connectionId: args.connectionId,
          error: err?.message || err,
        });
        return { success: false, error: String(err?.message || err) };
      }
    }
  );

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

          const preProviderCommands: string[] = [];
          if (providerId === 'opencode') {
            try {
              const remoteConfigDir = await writeRemoteOpenCodePlugin(ssh.args, ssh.target, id);
              preProviderCommands.push(`export OPENCODE_CONFIG_DIR="${remoteConfigDir}"`);
            } catch (err: any) {
              log.warn('ptyIpc:startDirect failed to write remote OpenCode plugin', {
                id,
                error: err?.message || String(err),
              });
            }
          }

          // Set up reverse SSH tunnel for hook events if the local hook
          // server is running. This lets the remote agent call back to
          // the local AgentEventService via the tunnel.
          const hookPort = agentEventService.getPort();
          if (hookPort > 0) {
            const remotePort = pickReverseTunnelPort(id);

            // For Claude, write hook config on the remote via ssh exec
            // (not keystroke injection — long JSON lines get corrupted by
            // terminal line-buffer limits when typed into the PTY).
            // Done before pushing -R so the exec connection doesn't
            // unnecessarily bind the reverse tunnel port.
            if (providerId === 'claude' && cwd) {
              try {
                await writeRemoteHookConfig(ssh.args, ssh.target, cwd);
              } catch (err: any) {
                log.warn('ptyIpc:startDirect failed to write remote hook config', {
                  id,
                  error: err?.message || String(err),
                });
              }
            }

            ssh.args.push('-R', `127.0.0.1:${remotePort}:127.0.0.1:${hookPort}`);

            preProviderCommands.push(
              `export EMDASH_HOOK_PORT=${quoteShellArg(String(remotePort))}`,
              `export EMDASH_HOOK_TOKEN=${quoteShellArg(agentEventService.getToken())}`,
              `export EMDASH_PTY_ID=${quoteShellArg(id)}`
            );
          }

          const remoteInitCommand = cwd ? buildRemoteInitShellCommand(cwd) : undefined;

          const proc = startSshPty({
            id,
            target: ssh.target,
            sshArgs: ssh.args,
            remoteInitCommand,
            cols,
            rows,
            env: mergedEnv,
          });

          if (!listeners.has(id)) {
            proc.onData((data) => {
              bufferedSendPtyData(id, data);
            });
            proc.onExit(({ exitCode, signal }) => {
              cancelPromptHandles(id);
              flushPtyData(id);
              clearPtyData(id);
              safeSendToOwner(id, `pty:exit:${id}`, { exitCode, signal });
              sendPtyExitGlobal(id);
              maybeMarkProviderFinish(id, exitCode, signal, 'process_exit');
              owners.delete(id);
              listeners.delete(id);
              removePtyRecord(id);
            });
            listeners.add(id);
          }

          // Resolve tmux config from remote .emdash.json.
          // Workspace-provisioned connections always use tmux for session persistence.
          const isWorkspaceConn = remote.connectionId.startsWith('workspace-');
          const remoteTmux =
            isWorkspaceConn || (cwd ? await resolveRemoteTmuxEnabled(ssh, cwd) : false);
          const tmuxOpt = remoteTmux ? { sessionName: getTmuxSessionName(id) } : undefined;

          const remoteInit = buildRemoteInitKeystrokes({
            cwd,
            provider: remoteProvider,
            tmux: tmuxOpt,
            preProviderCommands: preProviderCommands.length ? preProviderCommands : undefined,
          });
          if (remoteInit) {
            waitForSshPromptThenWrite(id, proc, remoteInit, 'ptyIpc:startDirect');
          }

          maybeMarkProviderStart(id);
          try {
            const windows = BrowserWindow.getAllWindows();
            windows.forEach((w: any) => w.webContents.send('pty:started', { id }));
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

        // For additional chats without per-session isolation, never resume —
        // they'd share the provider's directory-scoped session with other chats.
        let effectiveResume = resume;
        if (isChatPty(id)) {
          const chatProvider = getProvider(providerId as ProviderId);
          if (!chatProvider?.sessionIdFlag) {
            effectiveResume = false;
          }
        }

        if (providerId === 'codex') {
          await pruneInvalidCodexResumeTarget(id, cwd, effectiveResume);
        }

        maybeAutoTrustForClaude(providerId, cwd);

        // Wait for any in-flight setup script to finish before spawning the PTY.
        // Setup scripts (e.g. copying .claude/skills into the worktree) must complete
        // before the agent initializes, otherwise the copied files won't be picked up
        // in the first session.
        const parsedDirectPty = parsePtyId(id);
        if (parsedDirectPty?.kind === 'main') {
          await taskLifecycleService.awaitSetup(parsedDirectPty.suffix);
        }

        const shellSetup = await resolveShellSetup(cwd);
        const tmux = await resolveTmuxEnabled(cwd);
        const codexBindingStartedAt = providerId === 'codex' ? Date.now() : 0;

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
              });

        // Fall back to shell-based spawn when direct spawn is unavailable or shellSetup/tmux is set
        let usedFallback = false;
        let proc: import('node-pty').IPty;
        if (directProc) {
          proc = directProc;
        } else {
          const provider = getProvider(providerId as ProviderId);
          if (!provider?.cli) {
            return { ok: false, error: `CLI path not found for provider: ${providerId}` };
          }
          if (!shellSetup && !tmux)
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
            shellSetup,
            tmux,
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
            // Direct-spawn CLIs are replaced by a fallback shell via the
            // onDirectCliExit callback (registered in ptyManager).  That
            // callback is async — it calls startPty() which creates a new
            // PTY record and re-attaches listeners.  If we run cleanup
            // here synchronously we race with the async respawn: we'd
            // delete the PTY record and send pty:exit before the new shell
            // is ready, leaving the renderer with a dead terminal.
            //
            // So for direct spawns we only clean up listeners (the respawn
            // callback re-adds them) and leave the PTY record + owner
            // intact for the respawn to reuse.
            if (!usedFallback) {
              listeners.delete(id);
              return;
            }
            // Direct-spawn CLIs can be replaced immediately by a fallback shell after exit.
            // If this PTY has already been replaced, skip cleanup so we don't delete the new PTY record.
            const current = getPty(id);
            if (current && current !== proc) {
              return;
            }
            safeSendToOwner(id, `pty:exit:${id}`, { exitCode, signal });
            sendPtyExitGlobal(id);
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

        if (providerId === 'codex') {
          scheduleCodexThreadBinding(id, cwd, codexBindingStartedAt);
        }

        try {
          const windows = BrowserWindow.getAllWindows();
          windows.forEach((w: any) => w.webContents.send('pty:started', { id }));
        } catch {}

        return { ok: true, tmux };
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
