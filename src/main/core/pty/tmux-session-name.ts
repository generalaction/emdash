const TMUX_SESSION_PREFIX = 'emdash-';

export function makeTmuxSessionName(sessionId: string): string {
  const encoded = Buffer.from(sessionId, 'utf8').toString('base64url');
  return `${TMUX_SESSION_PREFIX}${encoded}`;
}
