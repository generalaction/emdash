import type { IExecutionContext } from '@main/core/execution-context/types';
import { booBackend } from './boo';
import { tmuxBackend } from './tmux';
import type { SessionKind } from './types';

/**
 * Kill an orphaned session whose backend id is no longer known. Agent ids may be
 * tmux- or boo-backed, so we kill both deterministic names (idempotent / no-op when
 * absent). Terminal ids are tmux-only. Runs on the resolved session host ctx.
 */
export async function killSessionById(opts: {
  hostCtx: IExecutionContext;
  kind: SessionKind;
  sessionId: string;
}): Promise<void> {
  const { hostCtx, kind, sessionId } = opts;
  const backends = kind === 'agent' ? [tmuxBackend, booBackend] : [tmuxBackend];
  await Promise.all(backends.map((b) => b.killSession(hostCtx, b.makeSessionName(sessionId))));
}
