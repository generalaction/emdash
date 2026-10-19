import {
  formatCommandLine,
  quoteArg,
  type Command,
  type IExecutionContext,
} from '#primitives/exec/api';
import { decodeTmuxIdentity, encodeTmuxIdentity, TMUX_IDENTITY_OPTION } from './tmux-identity';

const TMUX_HISTORY_LIMIT = 100_000;
const TMUX_LIST_FORMAT = `#{session_name}\t#{session_activity}\t#{${TMUX_IDENTITY_OPTION}}`;
const TMUX_ENV_KEYS = new Set([
  'TERM',
  'COLORTERM',
  'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION',
  'TMUX',
  'TMUX_PANE',
]);

export type TmuxSessionInventoryEntry = {
  name: string;
  activity: number;
  identity: string | null;
};

export function buildTmuxShellLine(
  sessionName: string,
  command: Pick<Command, 'command' | 'args'>,
  env: NodeJS.ProcessEnv,
  identity?: string
): string {
  const exactTarget = quoteArg(`=${sessionName}`, 'posix');
  const exactOptionTarget = quoteArg(`=${sessionName}:`, 'posix');
  const quotedName = quoteArg(sessionName, 'posix');
  const envKeys = Object.keys(env).filter(
    (key) =>
      env[key] !== undefined && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && !TMUX_ENV_KEYS.has(key)
  );
  const sessionEnv = envKeys
    .map((key) => {
      const value = env[key]?.endsWith(';') ? `\${${key}%;}\\;` : `\${${key}}`;
      return `-e ${key}="${value}"`;
    })
    .join(' ');
  const terminalEnv = [...TMUX_ENV_KEYS].map((key) => `\${${key}+${key}="$${key}"}`);
  const paneCommand = [
    'exec /usr/bin/env -i',
    ...envKeys.map((key) =>
      key === 'SHELL' ? `SHELL=${quoteArg(env.SHELL ?? '', 'posix')}` : `${key}="\${${key}}"`
    ),
    ...terminalEnv,
    formatCommandLine(command, 'posix'),
  ].join(' ');
  const checkExists = `tmux has-session -t ${exactTarget} 2>/dev/null`;
  const newSession = `tmux -u new-session -d -s ${quotedName} ${sessionEnv} /bin/sh -c ${quoteArg(paneCommand, 'posix')}`;
  const setIdentity = identity
    ? `tmux set-option -t ${exactOptionTarget} ${TMUX_IDENTITY_OPTION} ${quoteArg(encodeTmuxIdentity(identity), 'posix')} 2>/dev/null || true`
    : null;
  const enableMouse = `tmux set-option -t ${exactOptionTarget} mouse on 2>/dev/null || true`;
  const setHistoryLimit = `tmux set-option -t ${exactOptionTarget} history-limit ${TMUX_HISTORY_LIMIT} 2>/dev/null || true`;
  const ensureSession = `(${checkExists} || ${newSession})`;
  const configure = [setIdentity, enableMouse, setHistoryLimit]
    .filter((command): command is string => command !== null)
    .map((command) => `(${command})`)
    .join(' && ');
  const attach = `tmux -u attach-session -t ${exactTarget}`;
  return `/bin/sh -c ${quoteArg(`${ensureSession} && ${configure} && ${attach}`, 'posix')}`;
}

export async function listTmuxSessions(
  ctx: IExecutionContext
): Promise<TmuxSessionInventoryEntry[]> {
  try {
    const result = await ctx.exec('tmux', ['list-sessions', '-F', TMUX_LIST_FORMAT]);
    return parseTmuxSessionInventory(result.stdout);
  } catch (error) {
    if (isExpectedTmuxListFailure(error)) return [];
    throw error;
  }
}

export async function killTmuxSession(
  ctx: IExecutionContext,
  sessionName: string,
  onError?: (error: unknown) => void
): Promise<void> {
  try {
    await ctx.exec('tmux', ['kill-session', '-t', `=${sessionName}`]);
  } catch (error) {
    onError?.(error);
  }
}

export function parseTmuxSessionInventory(output: string): TmuxSessionInventoryEntry[] {
  const sessions: TmuxSessionInventoryEntry[] = [];
  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    const [name, seconds, encodedIdentity = ''] = line.split('\t');
    if (!name || !seconds) continue;
    const parsed = Number(seconds);
    if (!Number.isFinite(parsed)) continue;
    sessions.push({
      name,
      activity: parsed * 1_000,
      identity: decodeTmuxIdentity(encodedIdentity),
    });
  }
  return sessions;
}

function isExpectedTmuxListFailure(error: unknown): boolean {
  const failure = readExecFailure(error);
  if (!failure) return false;
  if (failure.executableMissing) return true;
  if (
    failure.exitCode === 1 &&
    /no server running|failed to connect to server|error connecting to .*\(no such file or directory\)/i.test(
      failure.stderr
    )
  ) {
    return true;
  }
  return failure.exitCode === 127;
}

/** Normalize the two execution-error shapes currently exposed by IExecutionContext. */
function readExecFailure(
  error: unknown
): { exitCode: number | null; stderr: string; executableMissing: boolean } | null {
  if (typeof error !== 'object' || error === null) return null;
  const stderr = 'stderr' in error && typeof error.stderr === 'string' ? error.stderr : '';
  if ('exitCode' in error && (typeof error.exitCode === 'number' || error.exitCode === null)) {
    const cause = 'cause' in error ? error.cause : undefined;
    const executableMissing =
      error.exitCode === null &&
      typeof cause === 'object' &&
      cause !== null &&
      'code' in cause &&
      cause.code === 'ENOENT';
    return { exitCode: error.exitCode, stderr, executableMissing };
  }
  if ('code' in error) {
    if (error.code === 'ENOENT') return { exitCode: null, stderr, executableMissing: true };
    if (typeof error.code === 'number') {
      return { exitCode: error.code, stderr, executableMissing: false };
    }
  }
  return null;
}
