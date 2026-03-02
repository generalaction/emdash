import os from 'os';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { IPty } from 'node-pty';
import { log } from '../lib/logger';
import { PROVIDERS, type ProviderDefinition } from '@shared/providers/registry';
import { parsePtyId } from '@shared/ptyId';
import { providerStatusCache } from './providerStatusCache';
import { errorTracking } from '../errorTracking';
import { getProviderCustomConfig } from '../settings';
import { agentEventService } from './AgentEventService';

/**
 * Environment variables to pass through for agent authentication.
 * These are passed to CLI tools during direct spawn (which skips shell config).
 */
const AGENT_ENV_VARS = [
  'AMP_API_KEY',
  'ANTHROPIC_API_KEY',
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
  'CODEBUFF_API_KEY',
  'COPILOT_CLI_TOKEN',
  'CURSOR_API_KEY',
  'DASHSCOPE_API_KEY',
  'FACTORY_API_KEY',
  'GEMINI_API_KEY',
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GOOGLE_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_LOCATION',
  'GOOGLE_CLOUD_PROJECT',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'KIMI_API_KEY',
  'MISTRAL_API_KEY',
  'MOONSHOT_API_KEY',
  'NO_PROXY',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
];

type PtyRecord = {
  id: string;
  proc: IPty;
  cwd?: string; // Working directory (for respawning shell after CLI exit)
  isDirectSpawn?: boolean; // Whether this was a direct CLI spawn
  kind?: 'local' | 'ssh';
  cols?: number;
  rows?: number;
};

const ptys = new Map<string, PtyRecord>();
const MIN_PTY_COLS = 2;
const MIN_PTY_ROWS = 1;

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

// ---------------------------------------------------------------------------
// Persistent session-ID map
//
// Tracks which PTY IDs have already been started with --session-id so we
// know whether to create a new session or resume an existing one.
//
//   First start  → no entry  → --session-id <uuid>  (create)
//   Restart      → entry     → --resume <uuid>      (resume)
// ---------------------------------------------------------------------------
type SessionEntry = { uuid: string; cwd: string };

let _sessionMapPath: string | null = null;
let _sessionMap: Record<string, SessionEntry> | null = null;

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

function getKnownSessionId(ptyId: string): string | undefined {
  return loadSessionMap()[ptyId]?.uuid;
}

/** Check if the session map has entries for other chats of the same provider in the same cwd. */
function hasOtherSameProviderSessions(ptyId: string, providerId: string, cwd: string): boolean {
  const map = loadSessionMap();
  const prefix = `${providerId}-`;
  return Object.entries(map).some(
    ([key, entry]) => key.startsWith(prefix) && key !== ptyId && entry.cwd === cwd
  );
}

function markSessionCreated(ptyId: string, uuid: string, cwd: string): void {
  const map = loadSessionMap();
  map[ptyId] = { uuid, cwd };
  try {
    fs.writeFileSync(sessionMapPath(), JSON.stringify(map));
  } catch (e) {
    log.warn('ptyManager: failed to persist session map', e);
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
  const prefix = `${providerId}-`;
  const uuids = new Set<string>();
  for (const [key, entry] of Object.entries(map)) {
    if (key.startsWith(prefix) && key !== ptyId && entry.cwd === cwd) {
      uuids.add(entry.uuid);
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
function applySessionIsolation(
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

  const knownSession = getKnownSessionId(id);
  if (knownSession) {
    cliArgs.push('--resume', knownSession);
    return true;
  }

  if (isAdditionalChat) {
    cliArgs.push(provider.sessionIdFlag, sessionUuid);
    markSessionCreated(id, sessionUuid, cwd);
    return true;
  }

  if (hasOtherSameProviderSessions(id, parsed.providerId, cwd)) {
    // Main chat transitioning to multi-chat mode. Try to discover its
    // existing session from Claude's local storage and adopt it.
    const otherUuids = getOtherSessionUuids(id, parsed.providerId, cwd);
    const existingSession = discoverExistingClaudeSession(cwd, otherUuids);
    if (existingSession) {
      cliArgs.push(provider.sessionIdFlag, existingSession);
      markSessionCreated(id, existingSession, cwd);
    } else {
      cliArgs.push(provider.sessionIdFlag, sessionUuid);
      markSessionCreated(id, sessionUuid, cwd);
    }
    return true;
  }

  if (!isResume) {
    // First-time creation — proactively assign a session ID so we can
    // reliably resume later if more chats of this provider are added.
    cliArgs.push(provider.sessionIdFlag, sessionUuid);
    markSessionCreated(id, sessionUuid, cwd);
    return true;
  }

  return false;
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
  autoApprove?: boolean;
  autoApproveFlag?: string;
  initialPrompt?: string;
  initialPromptFlag?: string;
  useKeystrokeInjection?: boolean;
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

  if (options.extraArgs?.length) {
    args.push(...options.extraArgs);
  }

  return args;
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
    ...(process.env.LANG && { LANG: process.env.LANG }),
    ...getDisplayEnv(),
    ...(process.env.SSH_AUTH_SOCK && { SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK }),
    ...(process.platform === 'win32' ? getWindowsEssentialEnv() : {}),
  };

  // Pass through agent authentication env vars (same allowlist as direct spawn)
  for (const key of AGENT_ENV_VARS) {
    if (process.env[key]) {
      useEnv[key] = process.env[key] as string;
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

  const args: string[] = ['-tt', ...sshArgs, target];
  if (typeof remoteInitCommand === 'string' && remoteInitCommand.trim().length > 0) {
    // Pass as a single remote command argument; ssh will execute it via the remote user's shell.
    args.push(remoteInitCommand);
  }

  const proc = pty.spawn('ssh', args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: process.env.HOME || os.homedir(),
    env: useEnv,
  });

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
}): IPty | null {
  if (process.env.EMDASH_DISABLE_PTY === '1') {
    throw new Error('PTY disabled via EMDASH_DISABLE_PTY=1');
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
    // Session isolation for multi-chat scenarios.
    // See applySessionIsolation() for the full decision tree.
    const usedSessionIsolation = applySessionIsolation(cliArgs, provider, id, cwd, !!resume);

    cliArgs.push(
      ...buildProviderCliArgs({
        resume: !usedSessionIsolation && !!resume,
        resumeFlag: resolvedConfig.resumeFlag,
        defaultArgs: resolvedConfig.defaultArgs,
        extraArgs: resolvedConfig.extraArgs,
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
    ...(process.env.LANG && { LANG: process.env.LANG }),
    ...getDisplayEnv(),
    ...(process.env.SSH_AUTH_SOCK && { SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK }),
    ...(process.platform === 'win32' ? getWindowsEssentialEnv() : {}),
  };

  // Pass through agent authentication env vars
  for (const key of AGENT_ENV_VARS) {
    if (process.env[key]) {
      useEnv[key] = process.env[key];
    }
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

  // Pass agent event hook env vars so CLI hooks can call back to Emdash
  const hookPort = agentEventService.getPort();
  if (hookPort > 0) {
    useEnv['EMDASH_HOOK_PORT'] = String(hookPort);
    useEnv['EMDASH_PTY_ID'] = id;
    useEnv['EMDASH_HOOK_TOKEN'] = agentEventService.getToken();
  }

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
  } = options;

  const defaultShell = getDefaultShell();
  let useShell = shell || defaultShell;
  const useCwd = cwd || process.cwd() || os.homedir();

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
  const useEnv: Record<string, string> = {
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'emdash',
    HOME: process.env.HOME || os.homedir(),
    USER: process.env.USER || os.userInfo().username,
    SHELL: process.env.SHELL || defaultShell,
    ...(process.platform === 'win32' ? getWindowsEssentialEnv() : {}),
    ...(process.env.LANG && { LANG: process.env.LANG }),
    ...getDisplayEnv(),
    ...(process.env.SSH_AUTH_SOCK && { SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK }),
    ...(env || {}),
  };

  // Pass agent event hook env vars so CLI hooks can call back to Emdash
  const hookPort = agentEventService.getPort();
  if (hookPort > 0) {
    useEnv['EMDASH_HOOK_PORT'] = String(hookPort);
    useEnv['EMDASH_PTY_ID'] = id;
    useEnv['EMDASH_HOOK_TOKEN'] = agentEventService.getToken();
  }

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
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  let pty: typeof import('node-pty');
  try {
    pty = require('node-pty');
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

        // Build the provider command with flags
        const cliArgs: string[] = [];

        // Session isolation — see applySessionIsolation() for the full decision tree.
        const usedSessionIsolation = applySessionIsolation(
          cliArgs,
          provider,
          id,
          useCwd,
          !skipResume
        );

        cliArgs.push(
          ...buildProviderCliArgs({
            resume: !usedSessionIsolation && !skipResume,
            resumeFlag: resolvedConfig?.resumeFlag,
            defaultArgs: resolvedConfig?.defaultArgs,
            extraArgs: resolvedConfig?.extraArgs,
            autoApprove,
            autoApproveFlag: resolvedConfig?.autoApproveFlag,
            initialPrompt,
            initialPromptFlag: resolvedConfig?.initialPromptFlag,
            useKeystrokeInjection: provider.useKeystrokeInjection,
          })
        );

        if (resolvedConfig?.env) {
          for (const [k, v] of Object.entries(resolvedConfig.env)) {
            if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && typeof v === 'string') {
              useEnv[k] = v;
            }
          }
        }

        const cliCommand = resolvedCli;
        const commandString =
          cliArgs.length > 0
            ? `${cliCommand} ${cliArgs
                .map((arg) =>
                  /[\s'"\\$`\n\r\t]/.test(arg) ? `'${arg.replace(/'/g, "'\\''")}'` : arg
                )
                .join(' ')}`
            : cliCommand;

        // After the provider exits, exec back into the user's shell (login+interactive)
        const resumeShell = `'${defaultShell.replace(/'/g, "'\\''")}' -il`;
        const chainCommand = shellSetup
          ? `${shellSetup} && ${commandString}; exec ${resumeShell}`
          : `${commandString}; exec ${resumeShell}`;

        // Always use the default shell for the -c command to avoid re-detecting provider CLI
        useShell = defaultShell;
        const shellBase = defaultShell.split('/').pop() || '';
        if (shellBase === 'zsh') args.push('-lic', chainCommand);
        else if (shellBase === 'bash') args.push('-lic', chainCommand);
        else if (shellBase === 'fish') args.push('-ic', chainCommand);
        else if (shellBase === 'sh') args.push('-lc', chainCommand);
        else args.push('-c', chainCommand); // Fallback for other shells
      } else {
        // For normal shells, use login + interactive to load user configs
        if (shellSetup) {
          const cFlag = base === 'fish' ? '-ic' : base === 'sh' ? '-lc' : '-lic';
          const resumeShell = `'${useShell.replace(/'/g, "'\\''")}' -il`;
          args.push(cFlag, `${shellSetup}; exec ${resumeShell}`);
        } else {
          args.push(
            base === 'zsh' || base === 'bash' || base === 'fish' || base === 'sh' ? '-il' : '-i'
          );
        }
      }
    } catch {}
  }

  let proc: IPty;
  try {
    const spawnSpec = resolveWindowsPtySpawn(useShell, args);
    proc = pty.spawn(spawnSpec.command, spawnSpec.args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: useCwd,
      env: useEnv,
    });
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

  ptys.set(id, { id, proc, kind: 'local', cols, rows });
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
