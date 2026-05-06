import type { IExecutionContext } from '@main/core/execution-context/types';
import { log } from '@main/lib/logger';

const TMUX_SESSION_PREFIX = 'emdash-';

export function buildTmuxShellLine(sessionName: string, commandLine: string): string {
  const quotedName = JSON.stringify(sessionName);
  const quotedCmd = JSON.stringify(commandLine);
  const checkExists = `tmux has-session -t ${quotedName} 2>/dev/null`;
  const newSession = `tmux new-session -d -s ${quotedName} ${quotedCmd}`;
  const attach = `tmux attach-session -t ${quotedName}`;
  return `(${checkExists} && ${attach}) || (${newSession} && ${attach})`;
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
