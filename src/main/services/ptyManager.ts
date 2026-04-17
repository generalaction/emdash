import os from 'os';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { StringDecoder } from 'string_decoder';
import type { IPty } from 'node-pty';
import { log } from '../lib/logger';
import { PROVIDERS, type ProviderDefinition } from '@shared/providers/registry';
import { parsePtyId } from '@shared/ptyId';
import { providerStatusCache } from './providerStatusCache';
import { errorTracking } from '../errorTracking';
import { LOCALE_ENV_VARS, DEFAULT_UTF8_LOCALE, isUtf8Locale } from '../utils/locale';
import { normalizeClaudeConfigDir } from '../utils/shellEnv';

/**
 * Suppress EPIPE/EIO errors on a PTY's underlying socket.
 *
 * On Windows, ConPTY emits EPIPE (not EIO) when the pipe breaks during
 * process shutdown. node-pty's built-in error handler only suppresses EIO,
 * so EPIPE becomes an uncaught exception. Registering an additional error
 * listener bumps the listener count to >= 2, which causes node-pty to
 * swallow the error instead of throwing.
 */
function suppressPtyPipeErrors(proc: IPty): void {
  if (process.platform !== 'win32') return;

  // IPty doesn't expose .on() in its type, but the underlying Terminal
  // class extends EventEmitter and proxies to the socket.
  (proc as any).on?.('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE' || err.code === 'EIO') return;
    log.warn('ptyManager: unexpected PTY error', { code: err.code, message: err.message });
  });
}
import { getProviderCustomConfig } from '../settings';
import { agentEventService } from './AgentEventService';
import { OpenCodeHookService } from './OpenCodeHookService';

/**
 * Environment variables to pass through for agent authentication.
 * These are passed to CLI tools during direct spawn (which skips shell config).
 */
const AGENT_ENV_VARS = [
  'AMP_API_KEY',
  'ANTHROPIC_API_KEY',
  'AUTOHAND_API_KEY',
  'AUGMENT_SESSION_AUTH',
  'AWS_ACCESS_KEY_ID',
  'AWS_DEFAULT_REGION',
  'AWS_PROFILE',
  'AWS_REGION',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AZURE_OPENAI_API_ENDPOINT',
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_KEY',
  'CLAUDE_CONFIG_DIR',
  'CODEBUFF_API_KEY',
  'COPILOT_CLI_TOKEN',
  'CURSOR_API_KEY',
  'DASHSCOPE_API_KEY',
  'FACTORY_API_KEY',
  'FORGE_API_KEY',
  'GEMINI_API_KEY',
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GOOGLE_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_LOCATION',
  'GOOGLE_CLOUD_PROJECT',
  'GLM_API_KEY',
  'GLM_BASE_URL',
  'BROWSERBASE_API_KEY',
  'BROWSERBASE_PROJECT_ID',
  'ELEVENLABS_API_KEY',
  'FAL_KEY',
  'FIRECRAWL_API_KEY',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'HONCHO_API_KEY',
  'KIMI_API_KEY',
  'KIMI_BASE_URL',
  'MISTRAL_API_KEY',
  'MINIMAX_API_KEY',
  'MINIMAX_BASE_URL',
  'MINIMAX_CN_API_KEY',
  'MINIMAX_CN_BASE_URL',
  'MOONSHOT_API_KEY',
  'NO_PROXY',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENROUTER_API_KEY',
  'TINKER_API_KEY',
  'VOICE_TOOLS_OPENAI_KEY',
  'WANDB_API_KEY',
];

type PtyRecord = {
  id: string;
  proc: IPty;
  cwd?: string; // Working directory (for respawning shell after CLI exit)
  isDirectSpawn?: boolean; // Whether this was a direct CLI spawn
  kind?: 'local' | 'ssh';
  cols?: number;
  rows?: number;
  tmuxSessionName?: string; // Set when session is wrapped in tmux
};

const ptys = new Map<string, PtyRecord>();
const MIN_PTY_COLS = 2;
const MIN_PTY_ROWS = 1;
export function getLocaleEnv(sourceEnv: NodeJS.ProcessEnv = process.env): Record<string, string> {
  if (process.platform === 'win32') {
    const localeEnv: Record<string, string> = {};
    for (const key of LOCALE_ENV_VARS) {
      const value = sourceEnv[key];
      if (value && isUtf8Locale(value)) {
        localeEnv[key] = value;
      }
    }
    return localeEnv;
  }

  // On non-Windows, preserve explicit UTF-8 locale choices and only fall back
  // to a minimal UTF-8 locale when no effective UTF-8 locale is available.
  const localeEnv: Record<string, string> = {};
  const lang = sourceEnv.LANG;
  const lcAll = sourceEnv.LC_ALL;
  const lcCtype = sourceEnv.LC_CTYPE;

  if (lcAll && isUtf8Locale(lcAll)) {
    localeEnv.LC_ALL = lcAll;
  }
  if (lang && isUtf8Locale(lang)) {
    localeEnv.LANG = lang;
  }
  if (lcCtype && isUtf8Locale(lcCtype)) {
    localeEnv.LC_CTYPE = lcCtype;
  }

  if (localeEnv.LC_ALL || localeEnv.LANG || localeEnv.LC_CTYPE) {
    return localeEnv;
  }

  localeEnv.LANG = DEFAULT_UTF8_LOCALE;
  localeEnv.LC_CTYPE = DEFAULT_UTF8_LOCALE;
  return localeEnv;
}

export function mergeEnvWithNormalizedLocale(
  ...envs: Array<NodeJS.ProcessEnv | undefined>
): Record<string, string> {
  const mergedEnv: NodeJS.ProcessEnv = {};

  for (const env of envs) {
    if (!env) continue;
    Object.assign(mergedEnv, env);
  }

  const localeEnv = getLocaleEnv(mergedEnv);
  for (const key of LOCALE_ENV_VARS) {
    delete mergedEnv[key];
  }

  return {
    ...mergedEnv,
    ...localeEnv,
  } as Record<string, string>;
}

function applyAgentEventHookEnv(env: Record<string, string>, ptyId: string): void {
  const hookPort = agentEventService.getPort();
  if (hookPort <= 0) return;

  env['EMDASH_HOOK_PORT'] = String(hookPort);
  env['EMDASH_PTY_ID'] = ptyId;
  env['EMDASH_HOOK_TOKEN'] = agentEventService.getToken();
}

function applyProviderSpecificRuntimeEnv(
  env: Record<string, string>,
  options: {
    ptyId: string;
    providerId?: string;
  }
): void {
  if (options.providerId === 'opencode') {
    OpenCodeHookService.applyLocalRuntimeEnv(env, options.ptyId);
  }
}

export function applyProviderRuntimeEnv(
  env: Record<string, string>,
  options: {
    ptyId: string;
    providerId?: string;
  }
): void {
  applyAgentEventHookEnv(env, options.ptyId);
  applyProviderSpecificRuntimeEnv(env, options);
}

function getWindowsEssentialEnv(): Record<string, string> {
  const home = os.homedir();
  return {
    PATH: process.env.PATH || process.env.Path || '',
    PATHEXT: process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC',
    SystemRoot: process.env.SystemRoot || 'C:\\Windows',
    ComSpec: process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe',
    TEMP: process.env.TEMP || process.env.TMP || '',
    TMP: process.env.TMP || process.env.TEMP || '',
    USERPROFILE: process.env.USERPROFILE || home,
    APPDATA: process.env.APPDATA || '',
    LOCALAPPDATA: process.env.LOCALAPPDATA || '',
    HOMEDRIVE: process.env.HOMEDRIVE || '',
    HOMEPATH: process.env.HOMEPATH || '',
    USERNAME: process.env.USERNAME || os.userInfo().username,
    // Program file paths needed by .NET, NuGet, MSBuild, and other tools
    ProgramFiles: process.env.ProgramFiles || 'C:\\Program Files',
    'ProgramFiles(x86)': process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    ProgramData: process.env.ProgramData || 'C:\\ProgramData',
    CommonProgramFiles: process.env.CommonProgramFiles || 'C:\\Program Files\\Common Files',
    'CommonProgramFiles(x86)':
      process.env['CommonProgramFiles(x86)'] || 'C:\\Program Files (x86)\\Common Files',
    ProgramW6432: process.env.ProgramW6432 || 'C:\\Program Files',
    CommonProgramW6432: process.env.CommonProgramW6432 || 'C:\\Program Files\\Common Files',
  };
}

// Display/desktop env vars needed for GUI operations from within PTY sessions.
const DISPLAY_ENV_VARS = [
  'DISPLAY', // X11 display server
  'XAUTHORITY', // X11 auth cookie (often at non-standard path on Wayland+GNOME)
  'WAYLAND_DISPLAY', // Wayland compositor socket
  'XDG_RUNTIME_DIR', // Contains Wayland/D-Bus sockets (e.g. /run/user/1000)
  'XDG_CURRENT_DESKTOP', // Used by xdg-open for DE detection (e.g. "GNOME")
  'XDG_SESSION_TYPE', // Used by browsers/toolkits to select X11 vs Wayland
  'XDG_DATA_DIRS', // .desktop file search paths; includes snap/flatpak dirs set by session
  'DBUS_SESSION_BUS_ADDRESS', // Needed by gio open and desktop portals
] as const;

function getDisplayEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of DISPLAY_ENV_VARS) {
    if (process.env[key]) {
      env[key] = process.env[key] as string;
    }
  }
  return env;
}

// --- Tmux session helpers ---

/**
 * Derive a deterministic tmux session name from a PTY ID.
 * Sanitizes to characters allowed by tmux (alphanumeric, `-`, `_`, `.`).
 */
export function getTmuxSessionName(ptyId: string): string {
  // PTY ID format: {providerId}-main-{taskId} or {providerId}-chat-{conversationId}
  // Prefix with "emdash-" and sanitize
  const sanitized = ptyId.replace(/[^a-zA-Z0-9._-]/g, '-');
  return `emdash-${sanitized}`;
}

function resolveTmuxPath(): string | null {
  return resolveCommandPathCached('tmux');
}

/**
 * Kill a tmux session by PTY ID. Fire-and-forget — ignores errors
 * for non-existent sessions (e.g., tmux not installed or session already dead).
 */
export function killTmuxSession(ptyId: string): void {
  const sessionName = getTmuxSessionName(ptyId);
  const tmuxPath = resolveTmuxPath();
  if (!tmuxPath) {
    return;
  }
  try {
    const { execFile } = require('child_process');
    execFile(tmuxPath, ['kill-session', '-t', sessionName], { timeout: 5000 }, (err: any) => {
      if (!err) {
        log.info('ptyManager:tmux - killed session', { sessionName });
      }
      // Ignore errors — session may not exist or tmux not installed
    });
  } catch {
    // Ignore
  }
}

// TODO: Remote tmux cleanup will be handled by the workspace provider teardown script.
// The PTY record doesn't currently store SSH target/args, so we can't shell out
// `ssh <target> tmux kill-session` from here. When workspace providers land, the
// teardown script is the right place for this.

function resolveWindowsPtySpawn(
  command: string,
  args: string[]
): { command: string; args: string[] } {
  if (process.platform !== 'win32') return { command, args };

  const quoteForCmdExe = (input: string): string => {
    if (input.length === 0) return '""';
    if (!/[\s"^&|<>()%!]/.test(input)) return input;
    return `"${input
      .replace(/%/g, '%%')
      .replace(/!/g, '^!')
      .replace(/(["^&|<>()])/g, '^$1')}"`;
  };

  const ext = path.extname(command).toLowerCase();
  if (ext === '.cmd' || ext === '.bat') {
    const comspec = process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe';
    const fullCommandString = [command, ...args].map(quoteForCmdExe).join(' ');
    return { command: comspec, args: ['/d', '/s', '/c', fullCommandString] };
  }
  if (ext === '.ps1') {
    return {
      command: 'powershell.exe',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', command, ...args],
    };
  }

  return { command, args };
}

/**
 * Generate a deterministic UUID from an arbitrary string.
 * Uses SHA-256 and formats 16 bytes as a UUID v4-compatible string
 * (with version and variant bits set per RFC 4122).
 */
function deterministicUuid(input: string): string {
  const hash = crypto.createHash('sha256').update(input).digest();
  // Set version 4 bits
  hash[6] = (hash[6] & 0x0f) | 0x40;
  // Set variant bits
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

type SessionStrategy = 'claude-session-id' | 'codex-thread-id';

// ---------------------------------------------------------------------------
// Persistent session map
//
// Tracks the exact resume target for PTYs that support strong session restore.
//
// Claude stores proactively assigned session IDs.
// Codex stores discovered thread IDs after first launch.
// ---------------------------------------------------------------------------
type SessionEntry = {
  cwd: string;
  providerId?: string;
  uuid?: string;
  resumeTarget?: string;
  strategy?: SessionStrategy;
};

type NormalizedSessionEntry = {
  cwd: string;
  providerId: string;
  target: string;
  strategy: SessionStrategy;
};

let _sessionMapPath: string | null = null;
let _sessionMap: Record<string, SessionEntry> | null = null;

/** @internal Exported for testing. Sets session map path and clears the cache. */
export function _resetSessionMapForTest(mapPath: string): void {
  _sessionMapPath = mapPath;
  _sessionMap = null;
}

function sessionMapPath(): string {
  if (!_sessionMapPath) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron');
    _sessionMapPath = path.join(app.getPath('userData'), 'pty-session-map.json');
  }
  return _sessionMapPath;
}

function loadSessionMap(): Record<string, SessionEntry> {
  if (_sessionMap) return _sessionMap;
  try {
    _sessionMap = JSON.parse(fs.readFileSync(sessionMapPath(), 'utf-8'));
  } catch {
    _sessionMap = {};
  }
  return _sessionMap!;
}

function getNormalizedSessionEntry(
  ptyId: string,
  entry: SessionEntry | undefined
): NormalizedSessionEntry | null {
  if (!entry || typeof entry !== 'object' || typeof entry.cwd !== 'string' || !entry.cwd) {
    return null;
  }

  const parsed = parsePtyId(ptyId);
  const providerId = entry.providerId || parsed?.providerId;
  if (!providerId) return null;

  if (typeof entry.resumeTarget === 'string' && entry.resumeTarget.trim()) {
    return {
      cwd: entry.cwd,
      providerId,
      target: entry.resumeTarget,
      strategy:
        entry.strategy === 'claude-session-id' || entry.strategy === 'codex-thread-id'
          ? entry.strategy
          : providerId === 'codex'
            ? 'codex-thread-id'
            : 'claude-session-id',
    };
  }

  if (typeof entry.uuid === 'string' && entry.uuid.trim()) {
    return {
      cwd: entry.cwd,
      providerId,
      target: entry.uuid,
      strategy: 'claude-session-id',
    };
  }

  return null;
}

/** Check if the session map has entries for other chats of the same provider in the same cwd. */
function hasOtherSameProviderSessions(ptyId: string, providerId: string, cwd: string): boolean {
  const map = loadSessionMap();
  return Object.entries(map).some(([key, entry]) => {
    if (key === ptyId) return false;
    const normalized = getNormalizedSessionEntry(key, entry);
    return normalized?.providerId === providerId && normalized.cwd === cwd;
  });
}

function persistSessionMap(): void {
  try {
    fs.writeFileSync(sessionMapPath(), JSON.stringify(loadSessionMap()));
  } catch (e) {
    log.warn('ptyManager: failed to persist session map', e);
  }
}

function setSessionEntry(ptyId: string, entry: SessionEntry): void {
  const map = loadSessionMap();
  map[ptyId] = entry;
  persistSessionMap();
}

function markClaudeSessionCreated(ptyId: string, uuid: string, cwd: string): void {
  setSessionEntry(ptyId, {
    cwd,
    providerId: 'claude',
    uuid,
    strategy: 'claude-session-id',
  });
}

export function markCodexSessionBound(ptyId: string, threadId: string, cwd: string): void {
  setSessionEntry(ptyId, {
    cwd,
    providerId: 'codex',
    resumeTarget: threadId,
    strategy: 'codex-thread-id',
  });
}

export function clearStoredSession(ptyId: string): void {
  const map = loadSessionMap();
  delete map[ptyId];
  try {
    fs.writeFileSync(sessionMapPath(), JSON.stringify(map));
  } catch (e) {
    log.warn('ptyManager: failed to persist session map after removal', e);
  }
}

export function getStoredResumeTarget(
  ptyId: string,
  providerId: string,
  cwd?: string
): string | null {
  const normalized = getNormalizedSessionEntry(ptyId, loadSessionMap()[ptyId]);
  if (!normalized || normalized.providerId !== providerId) return null;
  if (cwd && normalized.cwd !== cwd) return null;
  return normalized.target;
}

function claudeSessionFileExists(uuid: string, cwd: string): boolean {
  try {
    const encoded = cwd.replace(/[:\\/]/g, '-');
    const sessionFile = path.join(os.homedir(), '.claude', 'projects', encoded, `${uuid}.jsonl`);
    return fs.existsSync(sessionFile);
  } catch {
    return false;
  }
}

/**
 * Discover the existing Claude session ID for a working directory by scanning
 * Claude Code's local project storage (~/.claude/projects/<encoded-path>/).
 *
 * Claude stores each conversation as a <uuid>.jsonl file. We pick the most
 * recently modified file whose UUID is NOT already claimed by another chat
 * in our session map. This lets us seamlessly adopt an existing session
 * when transitioning the main chat to session-isolated mode, so no history
 * is lost.
 */
function discoverExistingClaudeSession(cwd: string, excludeUuids: Set<string>): string | null {
  try {
    // Claude encodes project paths by replacing path separators; on Windows also strip ':'.
    const encoded = cwd.replace(/[:\\/]/g, '-');
    const projectDir = path.join(os.homedir(), '.claude', 'projects', encoded);

    if (!fs.existsSync(projectDir)) return null;

    const entries = fs.readdirSync(projectDir).filter((f) => f.endsWith('.jsonl'));
    if (entries.length === 0) return null;

    // Sort by modification time, newest first
    const sorted = entries
      .map((f) => ({
        uuid: f.replace('.jsonl', ''),
        mtime: fs.statSync(path.join(projectDir, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);

    // Return the most recent session not claimed by another chat
    for (const entry of sorted) {
      if (!excludeUuids.has(entry.uuid)) {
        return entry.uuid;
      }
    }
    return null;
  } catch (e) {
    log.warn('ptyManager: failed to discover existing Claude session', e);
    return null;
  }
}

/** Collect all session UUIDs from the map that belong to a given provider in the same cwd, excluding one PTY. */
function getOtherSessionUuids(ptyId: string, providerId: string, cwd: string): Set<string> {
  const map = loadSessionMap();
  const uuids = new Set<string>();
  for (const [key, entry] of Object.entries(map)) {
    if (key === ptyId) continue;
    const normalized = getNormalizedSessionEntry(key, entry);
    if (
      normalized?.providerId === providerId &&
      normalized.cwd === cwd &&
      normalized.strategy === 'claude-session-id'
    ) {
      uuids.add(normalized.target);
    }
  }
  return uuids;
}

/**
 * Build session-isolation CLI args for a provider that supports sessionIdFlag.
 *
 * Decision tree:
 *   1. Known session in map        → --resume <uuid>
 *   2. Additional chat (new)       → --session-id <uuid>  (create)
 *   3. Multi-chat transition       → --session-id <discovered-uuid>  (adopt existing)
 *   4. First-time main chat        → --session-id <uuid>  (create, proactive)
 *   5. Existing single-chat resume → (no isolation, caller uses generic -c -r)
 *
 * Returns true if session isolation args were added.
 */
export function applySessionIsolation(
  cliArgs: string[],
  provider: ProviderDefinition,
  id: string,
  cwd: string,
  isResume: boolean
): boolean {
  if (!provider.sessionIdFlag) return false;

  const parsed = parsePtyId(id);
  if (!parsed) return false;

  const sessionUuid = deterministicUuid(parsed.suffix);
  const isAdditionalChat = parsed.kind === 'chat';

  const knownEntry = getNormalizedSessionEntry(id, loadSessionMap()[id]);
  const knownSession =
    knownEntry?.providerId === provider.id && knownEntry.strategy === 'claude-session-id'
      ? knownEntry.target
      : null;
  if (knownSession) {
    // For Claude, validate the session still exists on disk before resuming.
    // Also treat cwd mismatch as stale — the session belongs to a different
    // project context and Claude would look in the wrong directory.
    if (provider.id === 'claude') {
      const isStale = knownEntry!.cwd !== cwd || !claudeSessionFileExists(knownSession, cwd);
      if (isStale) {
        log.warn('ptyManager: stale session detected, creating new session', {
          ptyId: id,
          staleUuid: knownSession,
        });
        clearStoredSession(id);
        // Fall through — the decision tree below will create a new session
        // or the caller will use generic resume flags
      } else {
        cliArgs.push('--resume', knownSession);
        return true;
      }
    } else {
      cliArgs.push('--resume', knownSession);
      return true;
    }
  }

  if (isAdditionalChat) {
    cliArgs.push(provider.sessionIdFlag, sessionUuid);
    markClaudeSessionCreated(id, sessionUuid, cwd);
    return true;
  }

  if (isResume && hasOtherSameProviderSessions(id, parsed.providerId, cwd)) {
    // Main chat transitioning to multi-chat mode. Try to discover its
    // existing session from Claude's local storage and adopt it.
    const otherUuids = getOtherSessionUuids(id, parsed.providerId, cwd);
    const existingSession = discoverExistingClaudeSession(cwd, otherUuids);
    if (existingSession) {
      cliArgs.push(provider.sessionIdFlag, existingSession);
      markClaudeSessionCreated(id, existingSession, cwd);
    } else {
      cliArgs.push(provider.sessionIdFlag, sessionUuid);
      markClaudeSessionCreated(id, sessionUuid, cwd);
    }
    return true;
  }

  if (!isResume) {
    // First-time creation — proactively assign a session ID so we can
    // reliably resume later if more chats of this provider are added.
    cliArgs.push(provider.sessionIdFlag, sessionUuid);
    markClaudeSessionCreated(id, sessionUuid, cwd);
    return true;
  }

  return false;
}

export function getStoredExactResumeArgs(providerId: string, ptyId: string, cwd: string): string[] {
  const provider = PROVIDERS.find((item) => item.id === providerId);
  if (!provider) return [];

  const entry = getNormalizedSessionEntry(ptyId, loadSessionMap()[ptyId]);
  if (!entry || entry.cwd !== cwd || entry.providerId !== provider.id) {
    return [];
  }

  if (provider.id === 'codex' && entry.strategy === 'codex-thread-id') {
    return ['resume', entry.target];
  }

  return [];
}

/**
 * Parse a shell-style argument string into an array of arguments.
 * Handles single quotes, double quotes, and escape characters.
 *
 * Examples:
 *   '--flag1 --flag2' → ['--flag1', '--flag2']
 *   '--message "hello world"' → ['--message', 'hello world']
 *   "--path '/my dir/file'" → ['--path', '/my dir/file']
 *   '--arg "say \"hi\""' → ['--arg', 'say "hi"']
 */
export function parseShellArgs(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escape = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (escape) {
      // Handle escaped character
      current += char;
      escape = false;
      continue;
    }

    if (char === '\\') {
      if (process.platform === 'win32') {
        // Preserve backslashes for Windows paths. Only treat \" inside double-quotes as an escape.
        const next = input[i + 1];
        if (inDoubleQuote && next === '"') {
          escape = true;
          continue;
        }
      } else if (!inSingleQuote) {
        // POSIX-style backslash escapes next character (except inside single quotes)
        escape = true;
        continue;
      }
    }

    if (char === "'" && !inDoubleQuote) {
      // Toggle single quote mode
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      // Toggle double quote mode
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (char === ' ' && !inSingleQuote && !inDoubleQuote) {
      // Space outside quotes - end of argument
      if (current.length > 0) {
        args.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  // Handle trailing backslash: include it literally
  if (escape) {
    current += '\\';
  }

  // Warn on unclosed quotes (still push what we have)
  if (inSingleQuote || inDoubleQuote) {
    log.warn('parseShellArgs: unclosed quote in input', { input });
  }

  // Don't forget the last argument
  if (current.length > 0) {
    args.push(current);
  }

  return args;
}

export type ResolvedProviderCommandConfig = {
  provider: ProviderDefinition;
  cli: string;
  resumeFlag?: string;
  defaultArgs?: string[];
  autoApproveFlag?: string;
  initialPromptFlag?: string;
  extraArgs?: string[];
  env?: Record<string, string>;
};

type ProviderCliArgsOptions = {
  resume?: boolean;
  resumeFlag?: string;
  defaultArgs?: string[];
  extraArgs?: string[];
  runtimeArgs?: string[];
  autoApprove?: boolean;
  autoApproveFlag?: string;
  initialPrompt?: string;
  initialPromptFlag?: string;
  useKeystrokeInjection?: boolean;
};

type ProviderRuntimeCliArgsOptions = {
  providerId: string;
  target?: 'local' | 'remote';
  platform?: NodeJS.Platform;
};

export function resolveProviderCommandConfig(
  providerId: string
): ResolvedProviderCommandConfig | null {
  const provider = PROVIDERS.find((p) => p.id === providerId);
  if (!provider) return null;

  const customConfig = getProviderCustomConfig(provider.id);

  const extraArgs =
    customConfig?.extraArgs !== undefined && customConfig.extraArgs.trim() !== ''
      ? parseShellArgs(customConfig.extraArgs.trim())
      : undefined;

  let env: Record<string, string> | undefined;
  if (customConfig?.env && typeof customConfig.env === 'object') {
    env = {};
    for (const [k, v] of Object.entries(customConfig.env)) {
      if (typeof v === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
        env[k] = v;
      }
    }
    if (Object.keys(env).length === 0) env = undefined;
  }

  return {
    provider,
    cli:
      customConfig?.cli !== undefined && customConfig.cli !== ''
        ? customConfig.cli
        : provider.cli || providerId.toLowerCase(),
    resumeFlag:
      customConfig?.resumeFlag !== undefined ? customConfig.resumeFlag : provider.resumeFlag,
    defaultArgs:
      customConfig?.defaultArgs !== undefined
        ? parseShellArgs(customConfig.defaultArgs)
        : provider.defaultArgs,
    autoApproveFlag:
      customConfig?.autoApproveFlag !== undefined
        ? customConfig.autoApproveFlag
        : provider.autoApproveFlag,
    initialPromptFlag:
      customConfig?.initialPromptFlag !== undefined
        ? customConfig.initialPromptFlag
        : provider.initialPromptFlag,
    extraArgs,
    env,
  };
}

export function buildProviderCliArgs(options: ProviderCliArgsOptions): string[] {
  const args: string[] = [];

  if (options.resume && options.resumeFlag) {
    args.push(...parseShellArgs(options.resumeFlag));
  }

  if (options.defaultArgs?.length) {
    args.push(...options.defaultArgs);
  }

  if (options.autoApprove && options.autoApproveFlag) {
    args.push(...parseShellArgs(options.autoApproveFlag));
  }

  if (options.extraArgs?.length) {
    args.push(...options.extraArgs);
  }

  if (options.runtimeArgs?.length) {
    args.push(...options.runtimeArgs);
  }

  if (
    options.initialPromptFlag !== undefined &&
    !options.useKeystrokeInjection &&
    options.initialPrompt?.trim()
  ) {
    if (options.initialPromptFlag) {
      args.push(...parseShellArgs(options.initialPromptFlag));
    }
    args.push(options.initialPrompt.trim());
  }

  return args;
}

function makePosixCodexNotifyCommand(): string[] {
  const script =
    `printf '%s' "$1" | ` +
    `curl -sf -X POST ` +
    `-H 'Content-Type: application/json' ` +
    `-H "X-Emdash-Token: $EMDASH_HOOK_TOKEN" ` +
    `-H "X-Emdash-Pty-Id: $EMDASH_PTY_ID" ` +
    `-H 'X-Emdash-Event-Type: notification' ` +
    `-d @- ` +
    `"http://127.0.0.1:$EMDASH_HOOK_PORT/hook" || true`;

  return ['sh', '-lc', script, 'sh'];
}

function ensureWindowsCodexNotifyScript(): string {
  const scriptPath = path.join(os.tmpdir(), 'emdash-codex-notify.ps1');
  const script = [
    'param([string]$payload)',
    'try {',
    '  Invoke-WebRequest -UseBasicParsing -Method POST ' +
      "-Uri ('http://127.0.0.1:' + $env:EMDASH_HOOK_PORT + '/hook') " +
      '-Headers @{ ' +
      "'Content-Type' = 'application/json'; " +
      "'X-Emdash-Token' = $env:EMDASH_HOOK_TOKEN; " +
      "'X-Emdash-Pty-Id' = $env:EMDASH_PTY_ID; " +
      "'X-Emdash-Event-Type' = 'notification' " +
      '} -Body $payload | Out-Null',
    '} catch {',
    '  exit 0',
    '}',
    '',
  ].join('\n');

  try {
    fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
    fs.writeFileSync(scriptPath, script);
  } catch (err) {
    log.warn('ptyManager: failed to write Codex Windows notify script', {
      path: scriptPath,
      error: String(err),
    });
  }

  return scriptPath;
}

function makeWindowsCodexNotifyCommand(): string[] {
  // Use -File so Codex's appended payload argument binds reliably as a script parameter.
  return ['powershell.exe', '-NoProfile', '-File', ensureWindowsCodexNotifyScript()];
}

function makeCodexNotifyConfigValue(target: 'local' | 'remote', platform: NodeJS.Platform): string {
  const notifyCommand =
    target === 'remote' || platform !== 'win32'
      ? makePosixCodexNotifyCommand()
      : makeWindowsCodexNotifyCommand();

  return `notify=${JSON.stringify(notifyCommand)}`;
}

export function getProviderRuntimeCliArgs(options: ProviderRuntimeCliArgsOptions): string[] {
  const { providerId, target = 'local', platform = process.platform } = options;

  if (providerId !== 'codex') {
    return [];
  }

  if (agentEventService.getPort() <= 0) {
    return [];
  }

  return ['-c', makeCodexNotifyConfigValue(target, platform)];
}

const resolvedCommandPathCache = new Map<string, string | null>();

function resolveCommandPath(command: string): string | null {
  const trimmed = command.trim();
  if (!trimmed) return null;

  const pathLike =
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    trimmed.startsWith('.') ||
    /^[A-Za-z]:/.test(trimmed);

  const isExecutableFile = (candidate: string): boolean => {
    try {
      const stat = fs.statSync(candidate);
      if (!stat.isFile()) return false;
      if (process.platform === 'win32') return true;
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  };

  const appendWindowsExecutableExts = (base: string): string[] => {
    if (process.platform !== 'win32') return [base];

    if (path.extname(base)) return [base];

    const pathExt = process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD';
    const exts = pathExt
      .split(';')
      .map((ext) => ext.trim())
      .filter(Boolean);
    return [base, ...exts.map((ext) => `${base}${ext.toLowerCase()}`)];
  };

  const resolveFromCandidates = (bases: string[], makeAbsolute: boolean): string | null => {
    for (const base of bases) {
      const candidates = appendWindowsExecutableExts(base);
      for (const candidate of candidates) {
        const target = makeAbsolute ? path.resolve(candidate) : candidate;
        if (isExecutableFile(target)) {
          return target;
        }
      }
    }
    return null;
  };

  if (pathLike) {
    return resolveFromCandidates([trimmed], true);
  }

  const pathEnv = process.env.PATH;
  if (!pathEnv) return null;

  const pathDirs = pathEnv.split(path.delimiter).filter(Boolean);
  const pathCandidates = pathDirs.map((dir) => path.join(dir, trimmed));
  return resolveFromCandidates(pathCandidates, false);
}

export function parseCustomCliForDirectSpawn(input: string): string[] {
  const trimmed = input.trim();
  if (!trimmed) return [];

  if (process.platform !== 'win32') {
    return parseShellArgs(trimmed);
  }

  // Preserve backslashes for Windows absolute/UNC paths.
  if ((/^[A-Za-z]:\\/.test(trimmed) || /^\\\\/.test(trimmed)) && !/\s/.test(trimmed)) {
    return [trimmed];
  }

  // Handle quoted absolute paths with spaces, e.g. "C:\Program Files\tool\tool.cmd"
  const quotedAbsolutePath = trimmed.match(/^"([A-Za-z]:\\[^"]+)"$/);
  if (quotedAbsolutePath) {
    return [quotedAbsolutePath[1]];
  }
  const singleQuotedAbsolutePath = trimmed.match(/^'([A-Za-z]:\\[^']+)'$/);
  if (singleQuotedAbsolutePath) {
    return [singleQuotedAbsolutePath[1]];
  }

  return parseShellArgs(trimmed);
}

function resolveCommandPathCached(command: string): string | null {
  if (resolvedCommandPathCache.has(command)) {
    return resolvedCommandPathCache.get(command) ?? null;
  }
  const resolved = resolveCommandPath(command);
  resolvedCommandPathCache.set(command, resolved);
  return resolved;
}

function needsShellResolution(command: string): boolean {
  return /[|&;<>()$`]/.test(command);
}

// Callback to spawn shell after direct CLI exits (set by ptyIpc)
let onDirectCliExitCallback: ((id: string, cwd: string) => void) | null = null;

export function setOnDirectCliExit(callback: (id: string, cwd: string) => void): void {
  onDirectCliExitCallback = callback;
}

function escapeShSingleQuoted(value: string): string {
  // Safe for embedding into a single-quoted POSIX shell string.
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Spawn an interactive SSH session in a PTY.
 *
 * This uses the system `ssh` binary so user SSH config features (e.g. ProxyJump,
 * UseKeychain on macOS) work as expected.
 */
export function startSshPty(options: {
  id: string;
  target: string; // alias or user@host
  sshArgs?: string[]; // extra ssh args like -p, -i
  remoteInitCommand?: string; // if provided, executed by remote shell
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
}): IPty {
  if (process.env.EMDASH_DISABLE_PTY === '1') {
    throw new Error('PTY disabled via EMDASH_DISABLE_PTY=1');
  }

  const { id, target, sshArgs = [], remoteInitCommand, cols = 120, rows = 32, env } = options;

  // Lazy load native module
  let pty: typeof import('node-pty');
  try {
    pty = require('node-pty');
  } catch (e: any) {
    throw new Error(`PTY unavailable: ${e?.message || String(e)}`);
  }

  // Build a minimal environment; include SSH_AUTH_SOCK so agent works.
  const useEnv: Record<string, string> = {
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'emdash',
    HOME: process.env.HOME || os.homedir(),
    USER: process.env.USER || os.userInfo().username,
    PATH: process.env.PATH || process.env.Path || '',
    ...getLocaleEnv(),
    ...(process.env.TMPDIR && { TMPDIR: process.env.TMPDIR }),
    ...getDisplayEnv(),
    ...(process.env.SSH_AUTH_SOCK && { SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK }),
    ...(process.platform === 'win32' ? getWindowsEssentialEnv() : {}),
  };

  // Pass through agent authentication env vars (same allowlist as direct spawn)
  for (const key of AGENT_ENV_VARS) {
    const rawValue = process.env[key];
    if (!rawValue) continue;
    if (key === 'CLAUDE_CONFIG_DIR') {
      const normalized = normalizeClaudeConfigDir(rawValue);
      if (normalized) {
        useEnv[key] = normalized;
      }
      continue;
    }
    useEnv[key] = rawValue as string;
  }

  if (env) {
    for (const [key, value] of Object.entries(env)) {
      if (!key.startsWith('EMDASH_')) continue;
      if (typeof value === 'string') {
        useEnv[key] = value;
      }
    }
  }

  const args: string[] = ['-tt', ...sshArgs, target];
  if (typeof remoteInitCommand === 'string' && remoteInitCommand.trim().length > 0) {
    // Pass as a single remote command argument; ssh will execute it via the remote user's shell.
    args.push(remoteInitCommand);
  }

  // On Windows, resolve `ssh` to its full path. node-pty's ConPTY does not
  // reliably find bare command names via PATH (unlike Unix forkpty+execvp).
  // This mirrors the resolution done in startDirectPty / startPty.
  let sshCommand = 'ssh';
  if (process.platform === 'win32') {
    const resolved = resolveCommandPathCached('ssh');
    if (!resolved) {
      throw new Error(
        'SSH client not found. Install OpenSSH Client via Windows Settings → Apps → Optional Features, or install Git for Windows.'
      );
    }
    sshCommand = resolved;
  }

  const spawnSpec = resolveWindowsPtySpawn(sshCommand, args);
  const proc = pty.spawn(spawnSpec.command, spawnSpec.args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: process.env.HOME || os.homedir(),
    env: useEnv,
  });
  suppressPtyPipeErrors(proc);

  ptys.set(id, { id, proc, kind: 'ssh', cols, rows });
  return proc;
}

/**
 * Spawn a CLI directly without a shell wrapper.
 * This is faster because it skips shell config loading (oh-my-zsh, nvm, etc.)
 *
 * Returns null if the CLI path is not known (not in providerStatusCache)
 * or when CLI config requires shell parsing.
 */
export function startDirectPty(options: {
  id: string;
  providerId: string;
  cwd: string;
  cols?: number;
  rows?: number;
  autoApprove?: boolean;
  initialPrompt?: string;
  env?: Record<string, string>;
  resume?: boolean;
  tmux?: boolean;
}): IPty | null {
  if (process.env.EMDASH_DISABLE_PTY === '1') {
    throw new Error('PTY disabled via EMDASH_DISABLE_PTY=1');
  }

  // Tmux wrapping requires a shell — fall back to startPty() which handles tmux.
  if (options.tmux) {
    log.info('ptyManager:directSpawn - tmux enabled, falling back to shell spawn', {
      id: options.id,
    });
    return null;
  }

  const {
    id,
    providerId,
    cwd,
    cols = 120,
    rows = 32,
    autoApprove,
    initialPrompt,
    env,
    resume,
  } = options;

  const resolvedConfig = resolveProviderCommandConfig(providerId);
  const provider = resolvedConfig?.provider;

  // Get the CLI path from cache
  const status = providerStatusCache.get(providerId);
  if (!status?.installed || !status?.path) {
    log.warn('ptyManager:directSpawn - CLI path not found', { providerId });
    return null;
  }

  let cliPath = status.path;

  // Direct spawn requires an executable path. If custom CLI is an alias or shell
  // expression, fall back to shell mode.
  if (provider && resolvedConfig && resolvedConfig.cli !== provider.cli) {
    const cliParts = parseCustomCliForDirectSpawn(resolvedConfig.cli);
    if (cliParts.length !== 1) {
      log.info('ptyManager:directSpawn - custom CLI needs shell parsing, using fallback', {
        providerId,
        cli: resolvedConfig.cli,
      });
      return null;
    }

    const customCommand = cliParts[0];
    if (needsShellResolution(customCommand)) {
      log.info('ptyManager:directSpawn - custom CLI requires shell resolution, using fallback', {
        providerId,
        cli: resolvedConfig.cli,
      });
      return null;
    }

    const resolvedCustomPath = resolveCommandPathCached(customCommand);
    if (!resolvedCustomPath) {
      log.info('ptyManager:directSpawn - custom CLI not directly executable, using fallback', {
        providerId,
        cli: resolvedConfig.cli,
      });
      return null;
    }

    cliPath = resolvedCustomPath;
  }

  // Build CLI arguments
  const cliArgs: string[] = [];

  if (provider && resolvedConfig) {
    const exactResumeArgs = getStoredExactResumeArgs(provider.id, id, cwd);
    // Session isolation for multi-chat scenarios.
    // See applySessionIsolation() for the full decision tree.
    const usedSessionIsolation = applySessionIsolation(cliArgs, provider, id, cwd, !!resume);

    cliArgs.push(...exactResumeArgs);
    cliArgs.push(
      ...buildProviderCliArgs({
        resume: exactResumeArgs.length === 0 && !usedSessionIsolation && !!resume,
        resumeFlag: resolvedConfig.resumeFlag,
        defaultArgs: resolvedConfig.defaultArgs,
        extraArgs: resolvedConfig.extraArgs,
        runtimeArgs: getProviderRuntimeCliArgs({ providerId }),
        autoApprove,
        autoApproveFlag: resolvedConfig.autoApproveFlag,
        initialPrompt,
        initialPromptFlag: resolvedConfig.initialPromptFlag,
        useKeystrokeInjection: provider.useKeystrokeInjection,
      })
    );
  }

  // Build minimal environment - just what the CLI needs
  const useEnv: Record<string, string> = {
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'emdash',
    HOME: process.env.HOME || os.homedir(),
    USER: process.env.USER || os.userInfo().username,
    // Include PATH so CLI can find its dependencies
    PATH: process.env.PATH || process.env.Path || '',
    ...getLocaleEnv(),
    ...(process.env.TMPDIR && { TMPDIR: process.env.TMPDIR }),
    ...getDisplayEnv(),
    ...(process.env.SSH_AUTH_SOCK && { SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK }),
    ...(process.platform === 'win32' ? getWindowsEssentialEnv() : {}),
  };

  // Pass through agent authentication env vars
  for (const key of AGENT_ENV_VARS) {
    const rawValue = process.env[key];
    if (!rawValue) continue;
    if (key === 'CLAUDE_CONFIG_DIR') {
      const normalized = normalizeClaudeConfigDir(rawValue);
      if (normalized) {
        useEnv[key] = normalized;
      }
      continue;
    }
    useEnv[key] = rawValue;
  }

  if (resolvedConfig?.env) {
    for (const [key, value] of Object.entries(resolvedConfig.env)) {
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof value === 'string') {
        useEnv[key] = value;
      }
    }
  }

  if (env) {
    for (const [key, value] of Object.entries(env)) {
      if (!key.startsWith('EMDASH_')) continue;
      if (typeof value === 'string') {
        useEnv[key] = value;
      }
    }
  }

  applyProviderRuntimeEnv(useEnv, { ptyId: id, providerId });

  // Lazy load native module
  let pty: typeof import('node-pty');
  try {
    pty = require('node-pty');
  } catch (e: any) {
    throw new Error(`PTY unavailable: ${e?.message || String(e)}`);
  }

  const spawnSpec = resolveWindowsPtySpawn(cliPath, cliArgs);
  const proc = pty.spawn(spawnSpec.command, spawnSpec.args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env: useEnv,
  });
  suppressPtyPipeErrors(proc);

  // Store record with cwd for shell respawn after CLI exits
  ptys.set(id, { id, proc, cwd, isDirectSpawn: true, kind: 'local', cols, rows });

  // When CLI exits, spawn a shell so user can continue working
  proc.onExit(() => {
    const rec = ptys.get(id);
    if (rec?.isDirectSpawn && rec.cwd && onDirectCliExitCallback) {
      // Spawn shell immediately after CLI exits
      onDirectCliExitCallback(id, rec.cwd);
    }
  });

  return proc;
}

function getDefaultShell(): string {
  if (process.platform === 'win32') {
    // Prefer ComSpec (usually cmd.exe) or fallback to PowerShell
    return process.env.ComSpec || 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

export async function startPty(options: {
  id: string;
  cwd?: string;
  shell?: string;
  env?: NodeJS.ProcessEnv;
  cols?: number;
  rows?: number;
  autoApprove?: boolean;
  initialPrompt?: string;
  skipResume?: boolean;
  shellSetup?: string;
  tmux?: boolean;
}): Promise<IPty> {
  if (process.env.EMDASH_DISABLE_PTY === '1') {
    throw new Error('PTY disabled via EMDASH_DISABLE_PTY=1');
  }
  const {
    id,
    cwd,
    shell,
    env,
    cols = 80,
    rows = 24,
    autoApprove,
    initialPrompt,
    skipResume,
    shellSetup,
    tmux,
  } = options;

  const defaultShell = getDefaultShell();
  let useShell = shell || defaultShell;
  const useCwd = cwd || os.homedir();

  // Build a clean environment instead of inheriting process.env wholesale.
  //
  // WHY: When Emdash runs as an AppImage on Linux (or other packaged Electron apps),
  // the parent process.env contains packaging artifacts like PYTHONHOME, APPDIR,
  // APPIMAGE, etc. These variables can break user tools, especially Python virtual
  // environments which fail with "Could not find platform independent libraries"
  // when PYTHONHOME points to the AppImage's bundled Python.
  //
  // SOLUTION: Only pass through essential variables and let login shells (-il)
  // rebuild the environment from the user's shell configuration files
  // (.profile, .bashrc, .zshrc, etc.). This is how `sudo -i`, `ssh`, and other
  // tools create clean user environments.
  //
  // See: https://github.com/generalaction/emdash/issues/485
  const useEnv = mergeEnvWithNormalizedLocale({
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'emdash',
    HOME: process.env.HOME || os.homedir(),
    USER: process.env.USER || os.userInfo().username,
    SHELL: process.env.SHELL || defaultShell,
    ...(process.platform === 'win32' ? getWindowsEssentialEnv() : {}),
    ...(process.env.TMPDIR && { TMPDIR: process.env.TMPDIR }),
    ...(process.env.DISPLAY && { DISPLAY: process.env.DISPLAY }),
    ...getDisplayEnv(),
    ...(process.env.SSH_AUTH_SOCK && { SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK }),
    ...(env || {}),
  });

  applyAgentEventHookEnv(useEnv, id);

  // On Windows, resolve shell command to full path for node-pty
  if (process.platform === 'win32' && shell && !shell.includes('\\') && !shell.includes('/')) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { execSync } = require('child_process');

      // Try .cmd first (npm globals are typically .cmd files)
      let resolved = '';
      try {
        resolved = execSync(`where ${shell}.cmd`, { encoding: 'utf8' })
          .trim()
          .split('\n')[0]
          .replace(/\r/g, '')
          .trim();
      } catch {
        // If .cmd doesn't exist, try without extension
        resolved = execSync(`where ${shell}`, { encoding: 'utf8' })
          .trim()
          .split('\n')[0]
          .replace(/\r/g, '')
          .trim();
      }

      // Ensure we have an executable extension
      if (resolved && !resolved.match(/\.(exe|cmd|bat)$/i)) {
        // If no executable extension, try appending .cmd
        const cmdPath = resolved + '.cmd';
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const fs = require('fs');
          if (fs.existsSync(cmdPath)) {
            resolved = cmdPath;
          }
        } catch {
          // Ignore fs errors
        }
      }

      if (resolved) {
        useShell = resolved;
      }
    } catch {
      // Fall back to original shell name
    }
  }

  // Lazy load native module at call time to prevent startup crashes
  let pty: typeof import('node-pty');
  try {
    pty = await import('node-pty');
  } catch (e: any) {
    throw new Error(`PTY unavailable: ${e?.message || String(e)}`);
  }

  // Provide sensible defaults for interactive shells so they render prompts.
  // For provider CLIs, spawn the user's shell and run the provider command via -c,
  // then exec back into the shell to allow users to stay in a normal prompt after exiting the agent.
  const args: string[] = [];
  if (process.platform !== 'win32') {
    try {
      const base = String(useShell).split('/').pop() || '';
      const baseLower = base.toLowerCase();
      const provider = PROVIDERS.find((p) => p.cli === baseLower);

      if (provider) {
        const resolvedConfig = resolveProviderCommandConfig(provider.id);
        const resolvedCli = resolvedConfig?.cli || provider.cli || baseLower;

        if (resolvedConfig?.env) {
          for (const [k, v] of Object.entries(resolvedConfig.env)) {
            if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && typeof v === 'string') {
              useEnv[k] = v;
            }
          }
        }

        applyProviderSpecificRuntimeEnv(useEnv, { ptyId: id, providerId: provider.id });

        // Build the provider command with flags
        const cliArgs: string[] = [];
        const exactResumeArgs = getStoredExactResumeArgs(provider.id, id, useCwd);

        // Session isolation — see applySessionIsolation() for the full decision tree.
        const usedSessionIsolation = applySessionIsolation(
          cliArgs,
          provider,
          id,
          useCwd,
          !skipResume
        );

        cliArgs.push(...exactResumeArgs);
        cliArgs.push(
          ...buildProviderCliArgs({
            resume: exactResumeArgs.length === 0 && !usedSessionIsolation && !skipResume,
            resumeFlag: resolvedConfig?.resumeFlag,
            defaultArgs: resolvedConfig?.defaultArgs,
            extraArgs: resolvedConfig?.extraArgs,
            runtimeArgs: getProviderRuntimeCliArgs({ providerId: provider.id }),
            autoApprove,
            autoApproveFlag: resolvedConfig?.autoApproveFlag,
            initialPrompt,
            initialPromptFlag: resolvedConfig?.initialPromptFlag,
            useKeystrokeInjection: provider.useKeystrokeInjection,
          })
        );

        const cliCommand = resolvedCli;
        const commandString =
          cliArgs.length > 0
            ? `${cliCommand} ${cliArgs
                .map((arg) =>
                  /[\s'"\\$`\n\r\t]/.test(arg) ? `'${arg.replace(/'/g, "'\\''")}'` : arg
                )
                .join(' ')}`
            : cliCommand;

        const shellBase = (defaultShell.split('/').pop() || '').toLowerCase();

        // After the provider exits, exec back into the user's shell (login+interactive)
        const resumeShell =
          shellBase === 'fish'
            ? `'${defaultShell.replace(/'/g, "'\\''")}' -i -l`
            : `'${defaultShell.replace(/'/g, "'\\''")}' -il`;
        const chainCommand = shellSetup
          ? `${shellSetup} && ${commandString}; exec ${resumeShell}`
          : `${commandString}; exec ${resumeShell}`;

        // Always use the default shell for the -c command to avoid re-detecting provider CLI
        useShell = defaultShell;
        if (shellBase === 'zsh') args.push('-lic', chainCommand);
        else if (shellBase === 'bash') args.push('-lic', chainCommand);
        else if (shellBase === 'fish') args.push('-l', '-i', '-c', chainCommand);
        else if (shellBase === 'sh') args.push('-lc', chainCommand);
        else args.push('-c', chainCommand); // Fallback for other shells
      } else {
        // For normal shells, use login + interactive to load user configs
        if (shellSetup) {
          const resumeShell =
            baseLower === 'fish'
              ? `'${useShell.replace(/'/g, "'\\''")}' -i -l`
              : `'${useShell.replace(/'/g, "'\\''")}' -il`;
          if (baseLower === 'fish') {
            args.push('-l', '-i', '-c', `${shellSetup}; exec ${resumeShell}`);
          } else {
            const cFlag = baseLower === 'sh' ? '-lc' : '-lic';
            args.push(cFlag, `${shellSetup}; exec ${resumeShell}`);
          }
        } else {
          if (baseLower === 'fish') {
            args.push('-i', '-l');
          } else {
            args.push(
              baseLower === 'zsh' || baseLower === 'bash' || baseLower === 'sh' ? '-il' : '-i'
            );
          }
        }
      }
    } catch {}
  }

  // When tmux is enabled, wrap the spawn in a tmux session.
  // tmux new-session -As <name> creates or attaches to a named session.
  // The inner shell command (with the agent CLI) runs inside tmux.
  let tmuxSessionName: string | undefined;
  let spawnCommand = useShell;
  let spawnArgs = args;

  if (tmux && process.platform !== 'win32') {
    const tmuxPath = resolveTmuxPath();
    if (!tmuxPath) {
      log.warn('ptyManager:tmux - tmux not found, falling back to unwrapped spawn', { id });
    } else {
      tmuxSessionName = getTmuxSessionName(id);
      // Build: tmux new-session -As <name> -- <shell> <args...>
      spawnCommand = tmuxPath;
      spawnArgs = ['new-session', '-As', tmuxSessionName, '--', useShell, ...args];
      log.info('ptyManager:tmux - wrapping in tmux session', { id, tmuxSessionName, tmuxPath });
    }
  }

  let proc: IPty;
  try {
    const spawnSpec = resolveWindowsPtySpawn(spawnCommand, spawnArgs);
    proc = pty.spawn(spawnSpec.command, spawnSpec.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: useCwd,
      env: useEnv,
    });
    suppressPtyPipeErrors(proc);
  } catch (err: any) {
    // Track initial spawn error
    const provider = args.find((arg) => PROVIDERS.some((p) => p.cli === arg));
    await errorTracking.captureAgentSpawnError(err, shell || 'unknown', id, {
      cwd: useCwd,
      args: args.join(' '),
      provider: provider || undefined,
    });

    try {
      const fallbackShell = getDefaultShell();
      proc = pty.spawn(fallbackShell, [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: useCwd,
        env: useEnv,
      });
      suppressPtyPipeErrors(proc);
    } catch (err2: any) {
      // Track the fallback spawn error as critical
      await errorTracking.captureCriticalError(err2, {
        operation: 'pty_spawn_fallback',
        service: 'ptyManager',
        error_type: 'spawn_error',
        shell: getDefaultShell(),
        original_error: err?.message,
      });
      throw new Error(`PTY spawn failed: ${err2?.message || err?.message || String(err2 || err)}`);
    }
  }

  ptys.set(id, { id, proc, kind: 'local', cols, rows, tmuxSessionName });
  return proc;
}

export function writePty(id: string, data: string): void {
  const rec = ptys.get(id);
  if (!rec) {
    return;
  }
  rec.proc.write(data);
}

export function resizePty(id: string, cols: number, rows: number): void {
  const rec = ptys.get(id);
  if (!rec) {
    return;
  }
  const normalizedCols = Number.isFinite(cols) ? Math.max(MIN_PTY_COLS, Math.floor(cols)) : 0;
  const normalizedRows = Number.isFinite(rows) ? Math.max(MIN_PTY_ROWS, Math.floor(rows)) : 0;
  if (normalizedCols <= 0 || normalizedRows <= 0) return;
  if (rec.cols === normalizedCols && rec.rows === normalizedRows) return;
  try {
    rec.proc.resize(normalizedCols, normalizedRows);
    rec.cols = normalizedCols;
    rec.rows = normalizedRows;
  } catch (error: any) {
    if (
      error &&
      (error.code === 'EBADF' ||
        /EBADF/.test(String(error)) ||
        /Napi::Error/.test(String(error)) ||
        /ENOTTY/.test(String(error)) ||
        /ioctl\(2\) failed/.test(String(error)) ||
        error.message?.includes('not open'))
    ) {
      // Expected during shutdown - PTY already exited
      return;
    }
    log.error('ptyManager:resizeFailed', {
      id,
      cols: normalizedCols,
      rows: normalizedRows,
      error: String(error),
    });
  }
}

export function killPty(id: string): void {
  const rec = ptys.get(id);
  if (!rec) {
    return;
  }
  try {
    rec.proc.kill();
  } finally {
    ptys.delete(id);
  }
}

export function removePtyRecord(id: string): void {
  ptys.delete(id);
}

export function hasPty(id: string): boolean {
  return ptys.has(id);
}

export function getPty(id: string): IPty | undefined {
  return ptys.get(id)?.proc;
}

export function getPtyKind(id: string): 'local' | 'ssh' | undefined {
  return ptys.get(id)?.kind;
}

export function getPtyTmuxSessionName(id: string): string | undefined {
  return ptys.get(id)?.tmuxSessionName;
}

export interface LifecyclePtyHandle {
  pid: number | null;
  onData: (callback: (data: string) => void) => void;
  onExit: (callback: (exitCode: number | null, signal: string | null) => void) => void;
  onError: (callback: (error: Error) => void) => void;
  kill: (signal?: string) => void;
}

export function createUtf8StreamForwarder(emitData: (data: string) => void): {
  pushStdout: (buf: Buffer) => void;
  pushStderr: (buf: Buffer) => void;
  flush: () => void;
} {
  const stdoutDecoder = new StringDecoder('utf8');
  const stderrDecoder = new StringDecoder('utf8');
  let flushed = false;

  const emitIfPresent = (data: string) => {
    if (!data) return;
    emitData(data);
  };

  return {
    pushStdout: (buf: Buffer) => {
      emitIfPresent(stdoutDecoder.write(buf));
    },
    pushStderr: (buf: Buffer) => {
      emitIfPresent(stderrDecoder.write(buf));
    },
    flush: () => {
      if (flushed) return;
      flushed = true;
      emitIfPresent(stdoutDecoder.end());
      emitIfPresent(stderrDecoder.end());
    },
  };
}

type LifecycleSpawnFallbackChild = {
  stdout?: { on: (event: 'data', listener: (buf: Buffer) => void) => void } | null;
  stderr?: { on: (event: 'data', listener: (buf: Buffer) => void) => void } | null;
  on: (event: 'error' | 'exit' | 'close', listener: (...args: any[]) => void) => void;
};

export function attachLifecycleSpawnFallbackHandlers(
  child: LifecycleSpawnFallbackChild,
  callbacks: {
    onData: (data: string) => void;
    onExit: (exitCode: number | null, signal: string | null) => void;
    onError: (error: Error) => void;
  }
): void {
  const { onData, onExit, onError } = callbacks;
  let didExit = false;
  let exitCode: number | null = null;
  let exitSignal: string | null = null;
  const forwarder = createUtf8StreamForwarder(onData);

  child.stdout?.on('data', (buf: Buffer) => {
    forwarder.pushStdout(buf);
  });
  child.stderr?.on('data', (buf: Buffer) => {
    forwarder.pushStderr(buf);
  });

  child.on('error', (error: Error) => {
    forwarder.flush();
    onError(error);
  });

  child.on('exit', (code: number | null, signal: string | null) => {
    didExit = true;
    exitCode = code;
    exitSignal = signal ?? null;
  });

  child.on('close', () => {
    // Flush only after stdio closes so buffered UTF-8 bytes can complete.
    forwarder.flush();
    if (!didExit) return;
    onExit(exitCode, exitSignal);
  });
}

function startLifecycleSpawnFallback(options: {
  id: string;
  command: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
}): LifecyclePtyHandle {
  const { spawn } = require('node:child_process') as typeof import('node:child_process');
  const { command, cwd, env } = options;

  const child = spawn(command, {
    cwd: cwd || os.homedir(),
    shell: true,
    detached: true,
    env: mergeEnvWithNormalizedLocale(process.env, env),
  });

  const dataCallbacks: Array<(data: string) => void> = [];
  const exitCallbacks: Array<(exitCode: number | null, signal: string | null) => void> = [];
  const errorCallbacks: Array<(error: Error) => void> = [];
  attachLifecycleSpawnFallbackHandlers(child, {
    onData: (data) => {
      for (const cb of dataCallbacks) cb(data);
    },
    onExit: (code, signal) => {
      for (const cb of exitCallbacks) cb(code, signal);
    },
    onError: (error) => {
      for (const cb of errorCallbacks) cb(error);
    },
  });

  return {
    pid: child.pid ?? null,
    onData: (cb) => dataCallbacks.push(cb),
    onExit: (cb) => exitCallbacks.push(cb),
    onError: (cb) => errorCallbacks.push(cb),
    kill: (signal?: string) => {
      const pid = child.pid;
      if (!pid) return;
      try {
        if (process.platform === 'win32') {
          const args = ['/PID', String(pid), '/T'];
          if (signal === 'SIGKILL') args.push('/F');
          spawn('taskkill', args, { stdio: 'ignore' }).unref();
        } else {
          process.kill(-pid, (signal as NodeJS.Signals) || 'SIGTERM');
        }
      } catch {
        try {
          child.kill((signal as NodeJS.Signals) || 'SIGTERM');
        } catch {}
      }
    },
  };
}

export function startLifecyclePty(options: {
  id: string;
  command: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
}): LifecyclePtyHandle {
  if (process.env.EMDASH_DISABLE_PTY === '1') {
    return startLifecycleSpawnFallback(options);
  }

  let pty: typeof import('node-pty');
  try {
    pty = require('node-pty');
  } catch {
    return startLifecycleSpawnFallback(options);
  }

  const { id, command, cwd, env } = options;
  const defaultShell = getDefaultShell();

  const useEnv = mergeEnvWithNormalizedLocale({
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'emdash',
    HOME: process.env.HOME || os.homedir(),
    USER: process.env.USER || os.userInfo().username,
    SHELL: process.env.SHELL || defaultShell,
    ...(process.platform === 'win32' ? getWindowsEssentialEnv() : {}),
    ...(process.env.TMPDIR && { TMPDIR: process.env.TMPDIR }),
    ...(process.env.DISPLAY && { DISPLAY: process.env.DISPLAY }),
    ...getDisplayEnv(),
    ...(process.env.SSH_AUTH_SOCK && { SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK }),
    ...(env || {}),
  });

  const proc = pty.spawn(defaultShell, ['-ilc', command], {
    name: 'xterm-256color',
    cols: 120,
    rows: 32,
    cwd: cwd || os.homedir(),
    env: useEnv,
  });
  suppressPtyPipeErrors(proc);

  const dataCallbacks: Array<(data: string) => void> = [];
  const exitCallbacks: Array<(exitCode: number | null, signal: string | null) => void> = [];
  const errorCallbacks: Array<(error: Error) => void> = [];

  proc.onData((data: string) => {
    for (const cb of dataCallbacks) {
      cb(data);
    }
  });

  proc.onExit(({ exitCode, signal }: { exitCode: number; signal?: number }) => {
    ptys.delete(id);
    for (const cb of exitCallbacks) {
      cb(exitCode, signal != null ? String(signal) : null);
    }
  });

  // node-pty generally throws on startup failures instead of emitting an error event,
  // but keep the same interface as the child_process fallback.
  const emitError = (error: unknown) => {
    const normalized = error instanceof Error ? error : new Error(String(error));
    for (const cb of errorCallbacks) {
      cb(normalized);
    }
  };

  try {
    const maybeProc = proc as IPty & {
      on?: (event: string, listener: (error: unknown) => void) => void;
    };
    maybeProc.on?.('error', emitError);
  } catch {}

  ptys.set(id, { id, proc, cwd, kind: 'local', cols: 120, rows: 32 });

  return {
    pid: typeof proc.pid === 'number' ? proc.pid : null,
    onData: (cb) => dataCallbacks.push(cb),
    onExit: (cb) => exitCallbacks.push(cb),
    onError: (cb) => errorCallbacks.push(cb),
    kill: (signal?: string) => {
      ptys.delete(id);
      try {
        proc.kill(signal);
      } catch {}
    },
  };
}

/**
 * Return lightweight info about every active PTY for the performance monitor.
 * Only reads from the in-memory map — no I/O.
 */
export function getActivePtyInfo(): Array<{
  ptyId: string;
  pid: number | null;
  kind: 'local' | 'ssh';
  cwd?: string;
}> {
  const result: Array<{
    ptyId: string;
    pid: number | null;
    kind: 'local' | 'ssh';
    cwd?: string;
  }> = [];
  for (const [id, rec] of ptys) {
    result.push({
      ptyId: id,
      pid: typeof rec.proc.pid === 'number' ? rec.proc.pid : null,
      kind: rec.kind ?? 'local',
      cwd: rec.cwd,
    });
  }
  return result;
}
