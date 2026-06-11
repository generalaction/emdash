import type { IExecutionContext } from '@emdash/shared/exec';
import { log } from '@main/lib/logger';

const TMUX_SESSION_PREFIX = 'emdash-';
const TMUX_HISTORY_LIMIT = 100_000;

export function buildTmuxShellLine(sessionName: string, commandLine: string): string {
  const quotedName = JSON.stringify(sessionName);
  const quotedCmd = JSON.stringify(commandLine);
  const checkExists = `tmux has-session -t ${quotedName} 2>/dev/null`;
  const newSession = `tmux new-session -d -s ${quotedName} ${quotedCmd}`;
  const enableMouse = `tmux set-option -t ${quotedName} mouse on 2>/dev/null || true`;
  const setHistoryLimit = `tmux set-option -t ${quotedName} history-limit ${TMUX_HISTORY_LIMIT} 2>/dev/null || true`;
  const configure = `(${enableMouse}) && (${setHistoryLimit})`;
  const attach = `tmux attach-session -t ${quotedName}`;
  const script = `(${checkExists} || ${newSession}) && ${configure} && ${attach}`;
  return `/bin/sh -c ${JSON.stringify(script)}`;
}

export function makeTmuxSessionName(sessionId: string): string {
  const encoded = Buffer.from(sessionId, 'utf8').toString('base64url');
  return `${TMUX_SESSION_PREFIX}${encoded}`;
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
