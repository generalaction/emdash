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
// The launcher's own variables; task variables with this prefix are not forwarded.
const TMUX_TRANSFER_PREFIX = 'EMDASH_TMUX_ENV';
// Linux caps each environment string at 128 KiB; 32K UTF-16 units stay below it as UTF-8.
const TMUX_TRANSFER_CHUNK_LENGTH = 32_768;

export type TmuxSessionInventoryEntry = {
  name: string;
  activity: number;
  identity: string | null;
};

export type TmuxLaunch = {
  shellLine: string;
  /** The task env plus launch-only chunks; the launcher removes the chunks before running tmux. */
  env: Record<string, string>;
};

/**
 * Attaches to the session, creating it first with exactly the task's environment.
 *
 * Process arguments are readable by other users, so values never appear in any command
 * line. The serialized environment travels in the launcher's own environment and then
 * through a FIFO in a private temporary directory; the pane starts from an empty
 * environment, keeps tmux's terminal metadata, and restores the task's variables before
 * it runs the command. A truncated transfer fails closed.
 */
export function buildTmuxShellLine(
  sessionName: string,
  command: Pick<Command, 'command' | 'args'>,
  env: Record<string, string>,
  identity?: string
): TmuxLaunch {
  const exactTarget = quoteArg(`=${sessionName}`, 'posix');
  const exactOptionTarget = quoteArg(`=${sessionName}:`, 'posix');
  const quotedName = quoteArg(sessionName, 'posix');
  const taskEnv = Object.entries(env).filter(([key]) => !key.startsWith(TMUX_TRANSFER_PREFIX));
  const transfer = chunkTmuxTransfer([
    ...taskEnv
      .filter(([key]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && !TMUX_ENV_KEYS.has(key))
      // One statement per line, so quoted newlines are spelled as a variable. `command`
      // keeps a shell-readonly name (e.g. UID in bash) from aborting the restore.
      .map(([key, value]) => {
        const quoted = quoteArg(value, 'posix').replaceAll('\n', `'"$EMDASH_TMUX_ENV_NL"'`);
        return `command export ${key}=${quoted}\n`;
      }),
    'EMDASH_TMUX_ENV_END=1\n',
  ]);
  const chunkKeys = transfer.map(([key]) => key);
  const terminalEnv = [...TMUX_ENV_KEYS].map((key) => `\${${key}+${key}="$${key}"}`);
  const restoreEnv =
    `unset PWD SHLVL; EMDASH_TMUX_ENV_NL='\n'; ` +
    'while IFS= read -r EMDASH_TMUX_ENV_LINE; do eval "$EMDASH_TMUX_ENV_LINE"; done <&3 2>/dev/null; ' +
    'exec 3<&-; [ "${EMDASH_TMUX_ENV_END-}" = 1 ] || exit 1; ' +
    'unset EMDASH_TMUX_ENV_NL EMDASH_TMUX_ENV_LINE EMDASH_TMUX_ENV_END; ' +
    `exec ${formatCommandLine(command, 'posix')}`;
  const paneCommand = [
    'exec 3<"$1" && exec /usr/bin/env -i',
    ...terminalEnv,
    `/bin/sh -c ${quoteArg(restoreEnv, 'posix')}`,
  ].join(' ');
  const readTransfer =
    `EMDASH_TMUX_ENV=${chunkKeys.map((key) => `\${${key}}`).join('')}; ` +
    `unset ${chunkKeys.join(' ')}`;
  const checkExists = `tmux has-session -t ${exactTarget} 2>/dev/null`;
  // Ignoring signals until the transfer ends keeps a closing terminal from stranding the pane.
  const newSession =
    "trap '' HUP INT TERM PIPE; " +
    `trap '[ -z "\${EMDASH_TMUX_ENV_DIR-}" ] || { rm -f "$EMDASH_TMUX_ENV_DIR/env"; rmdir "$EMDASH_TMUX_ENV_DIR"; }' EXIT; ` +
    'case ${TMPDIR-} in /*) EMDASH_TMUX_ENV_DIR=$TMPDIR ;; *) EMDASH_TMUX_ENV_DIR=/tmp ;; esac; ' +
    'EMDASH_TMUX_ENV_DIR=$(mktemp -d "$EMDASH_TMUX_ENV_DIR/emdash-tmux.XXXXXXXX") && ' +
    'mkfifo -m 600 "$EMDASH_TMUX_ENV_DIR/env" && ' +
    `tmux -u new-session -d -s ${quotedName} /bin/sh -c ${quoteArg(paneCommand, 'posix')} sh "$EMDASH_TMUX_ENV_DIR/env" && ` +
    `printf '%s' "$EMDASH_TMUX_ENV" >"$EMDASH_TMUX_ENV_DIR/env"`;
  const setIdentity = identity
    ? `tmux set-option -t ${exactOptionTarget} ${TMUX_IDENTITY_OPTION} ${quoteArg(encodeTmuxIdentity(identity), 'posix')} 2>/dev/null || true`
    : null;
  const enableMouse = `tmux set-option -t ${exactOptionTarget} mouse on 2>/dev/null || true`;
  const setHistoryLimit = `tmux set-option -t ${exactOptionTarget} history-limit ${TMUX_HISTORY_LIMIT} 2>/dev/null || true`;
  const ensureSession = `(${checkExists} || { ${newSession}; })`;
  const configure = [setIdentity, enableMouse, setHistoryLimit]
    .filter((command): command is string => command !== null)
    .map((command) => `(${command})`)
    .join(' && ');
  const attach = `tmux -u attach-session -t ${exactTarget}`;
  return {
    shellLine: `/bin/sh -c ${quoteArg(`${readTransfer}; ${ensureSession} && ${configure} && ${attach}`, 'posix')}`,
    env: Object.fromEntries([...taskEnv, ...transfer]),
  };
}

function chunkTmuxTransfer(lines: string[]): Array<[string, string]> {
  const chunks = [''];
  for (const line of lines) {
    const last = chunks.length - 1;
    if (chunks[last] && chunks[last].length + line.length > TMUX_TRANSFER_CHUNK_LENGTH) {
      chunks.push('');
    }
    chunks[chunks.length - 1] += line;
  }
  return chunks.map((chunk, index) => [`EMDASH_TMUX_ENV_${index}`, chunk]);
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
