import type { ExecFn } from '@main/core/utils/exec';
import { log } from '@main/lib/logger';

const TMUX_SESSION_PREFIX = 'emdash-';

export function makeTmuxSessionName(sessionId: string): string {
  const encoded = Buffer.from(sessionId, 'utf8').toString('base64url');
  return `${TMUX_SESSION_PREFIX}${encoded}`;
}

export async function killTmuxSession(exec: ExecFn, sessionName: string): Promise<void> {
  try {
    await exec('tmux', ['kill-session', '-t', sessionName]);
  } catch (err) {
    log.debug('killTmuxSession: tmux session not found or already dead', {
      sessionName,
      error: String(err),
    });
  }
}
