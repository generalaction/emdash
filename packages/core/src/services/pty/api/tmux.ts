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
