import type { IExecutionContext } from '#primitives/exec/api';

export const TMUX_SESSION_PREFIX = 'emdash-';
const TMUX_HISTORY_LIMIT = 100_000;

export function buildTmuxShellLine(sessionName: string, commandLine: string): string {
  const quotedName = JSON.stringify(sessionName);
  const quotedCmd = JSON.stringify(commandLine);
  const checkExists = `tmux has-session -t ${quotedName} 2>/dev/null`;
  const newSession = `tmux -u new-session -d -s ${quotedName} ${quotedCmd}`;
  const enableMouse = `tmux set-option -t ${quotedName} mouse on 2>/dev/null || true`;
  const setHistoryLimit = `tmux set-option -t ${quotedName} history-limit ${TMUX_HISTORY_LIMIT} 2>/dev/null || true`;
  const configure = `(${enableMouse}) && (${setHistoryLimit})`;
  const attach = `tmux -u attach-session -t ${quotedName}`;
  const script = `(${checkExists} || ${newSession}) && ${configure} && ${attach}`;
  return `/bin/sh -c ${JSON.stringify(script)}`;
}

/**
 * Session names show up in tmux status bars (#2706), so UUID-backed session ids
 * (`uuid:uuid:uuid`) pack into their raw 48 bytes instead of base64url-ing the
 * 110-character text. Anything else keeps the legacy utf8 encoding, and decoding
 * still accepts names created by older builds.
 */
export function makeTmuxSessionName(sessionId: string): string {
  const packed = packUuidSessionId(sessionId);
  const encoded = (packed ?? Buffer.from(sessionId, 'utf8')).toString('base64url');
  return `${TMUX_SESSION_PREFIX}${encoded}`;
}

export function decodeTmuxSessionName(sessionName: string): string | null {
  if (!sessionName.startsWith(TMUX_SESSION_PREFIX)) return null;
  const encoded = sessionName.slice(TMUX_SESSION_PREFIX.length);
  if (!encoded) return null;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(encoded, 'base64url');
  } catch {
    return null;
  }
  // The round-trip guard disambiguates packed from legacy encodings: a candidate
  // is accepted when this name is any of its valid encodings.
  const candidates = [unpackUuidSessionId(bytes), bytes.toString('utf8')];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const encodings = [Buffer.from(candidate, 'utf8'), packUuidSessionId(candidate)].filter(
      (buffer) => buffer !== null
    );
    if (encodings.some((buffer) => buffer.toString('base64url') === encoded)) return candidate;
  }
  return null;
}

const UUID_TEXT_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function packUuidSessionId(sessionId: string): Buffer | null {
  const parts = sessionId.split(':');
  if (parts.length !== 3 || !parts.every((part) => UUID_TEXT_PATTERN.test(part))) return null;
  return Buffer.concat(parts.map((part) => Buffer.from(part.replace(/-/g, ''), 'hex')));
}

function unpackUuidSessionId(bytes: Buffer): string | null {
  if (bytes.length !== 48) return null;
  const hex = bytes.toString('hex');
  return [0, 32, 64].map((offset) => formatUuidText(hex.slice(offset, offset + 32))).join(':');
}

function formatUuidText(hex: string): string {
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

export async function listTmuxSessionActivity(
  ctx: IExecutionContext
): Promise<Map<string, number>> {
  try {
    const result = await ctx.exec('tmux', [
      'list-sessions',
      '-F',
      '#{session_name}\t#{session_activity}',
    ]);
    return parseTmuxSessionActivity(result.stdout);
  } catch (error) {
    if (isExpectedTmuxListFailure(error)) return new Map();
    throw error;
  }
}

export function parseTmuxSessionActivity(output: string): Map<string, number> {
  const activity = new Map<string, number>();
  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    const [name, seconds] = line.split('\t');
    if (!name || !seconds) continue;
    const parsed = Number(seconds);
    if (!Number.isFinite(parsed)) continue;
    activity.set(name, parsed * 1_000);
  }
  return activity;
}

export async function killTmuxSession(
  ctx: IExecutionContext,
  sessionName: string,
  onError?: (error: unknown) => void
): Promise<void> {
  try {
    await ctx.exec('tmux', ['kill-session', '-t', sessionName]);
  } catch (error) {
    onError?.(error);
  }
}

function isExpectedTmuxListFailure(error: unknown): boolean {
  const failure = readExecFailure(error);
  if (!failure) return false;
  if (failure.spawnFailed) return true;
  if (
    failure.exitCode === 1 &&
    /no server running|failed to connect to server/i.test(failure.stderr)
  ) {
    return true;
  }
  return failure.exitCode === 127 || /command not found|not found/i.test(failure.stderr);
}

/**
 * IExecutionContext does not declare its error mode yet, so two shapes flow
 * through it: BoundExec's ExecError ({ exitCode, stderr }) and
 * NodeExecutionContext's raw promisified-execFile errors ({ code, stderr },
 * where code is 'ENOENT' when the binary is missing). Accept both until the
 * unified ExecError lands (.scratch/exec-and-layering/map.md).
 */
function readExecFailure(
  error: unknown
): { exitCode: number | null; stderr: string; spawnFailed: boolean } | null {
  if (typeof error !== 'object' || error === null) return null;
  const stderr = 'stderr' in error && typeof error.stderr === 'string' ? error.stderr : '';
  if ('exitCode' in error && (typeof error.exitCode === 'number' || error.exitCode === null)) {
    return { exitCode: error.exitCode, stderr, spawnFailed: false };
  }
  if ('code' in error) {
    if (error.code === 'ENOENT') return { exitCode: null, stderr, spawnFailed: true };
    if (typeof error.code === 'number') return { exitCode: error.code, stderr, spawnFailed: false };
  }
  return null;
}
