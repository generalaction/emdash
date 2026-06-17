import type { IExecutionContext } from '@main/core/execution-context/types';

export type MultiplexerId = 'tmux' | 'boo';
export type SessionKind = 'agent' | 'terminal';

export interface MultiplexerBackend {
  readonly id: MultiplexerId;
  /** Deterministic, shell-safe session name for a pty session id. */
  makeSessionName(sessionId: string): string;
  /** A `/bin/sh -c '…'` line that ensures the session exists and attaches to it. */
  buildAttachShellLine(sessionName: string, commandLine: string): string;
  killSession(ctx: IExecutionContext, sessionName: string): Promise<void>;
}
