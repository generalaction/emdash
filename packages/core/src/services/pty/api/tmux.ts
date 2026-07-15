import type { IExecutionContext } from '@primitives/exec/api';

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

export function makeTmuxSessionName(sessionId: string): string {
  const encoded = Buffer.from(sessionId, 'utf8').toString('base64url');
  return `${TMUX_SESSION_PREFIX}${encoded}`;
}

export function decodeTmuxSessionName(sessionName: string): string | null {
  if (!sessionName.startsWith(TMUX_SESSION_PREFIX)) return null;
  const encoded = sessionName.slice(TMUX_SESSION_PREFIX.length);
  if (!encoded) return null;
  try {
    const sessionId = Buffer.from(encoded, 'base64url').toString('utf8');
    if (makeTmuxSessionName(sessionId) !== sessionName) return null;
    return sessionId;
  } catch {
    return null;
  }
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
  if (!isExecLikeError(error)) return false;
  if (error.exitCode === 1 && /no server running|failed to connect to server/i.test(error.stderr)) {
    return true;
  }
  return error.exitCode === 127 || /command not found|not found/i.test(error.stderr);
}

function isExecLikeError(error: unknown): error is { exitCode: number | null; stderr: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'exitCode' in error &&
    'stderr' in error &&
    (typeof error.exitCode === 'number' || error.exitCode === null) &&
    typeof error.stderr === 'string'
  );
}
