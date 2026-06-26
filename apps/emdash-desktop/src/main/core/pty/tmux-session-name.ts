import type { IExecutionContext } from '@main/core/execution-context/types';
import { log } from '@main/lib/logger';

export const TMUX_SESSION_PREFIX = 'emdash-';
const TMUX_HISTORY_LIMIT = 100_000;

export function buildTmuxShellLine(sessionName: string, commandLine: string): string {
  const quotedName = JSON.stringify(sessionName);
  const quotedCmd = JSON.stringify(commandLine);
  // `-u` forces tmux into UTF-8 mode regardless of the inherited locale. GUI-launched
  // apps (e.g. Electron on macOS) often have no LANG set, so without this tmux assumes a
  // non-UTF-8 locale and mangles multibyte glyphs like Nerd-font/box-drawing characters.
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

/**
 * Inverse of {@link makeTmuxSessionName}. Returns the encoded PTY session id, or
 * `null` if the name is not a well-formed emdash tmux session name. The
 * round-trip guard rejects anything that does not re-encode to exactly the same
 * name, so unrelated `emdash-*` sessions are never misread as ours.
 */
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

export async function killTmuxSession(ctx: IExecutionContext, sessionName: string): Promise<void> {
  try {
    await ctx.exec('tmux', ['kill-session', '-t', sessionName]);
  } catch (err) {
    log.debug('killTmuxSession: tmux session not found or already dead', {
      sessionName,
      error: String(err),
    });
  }
}
