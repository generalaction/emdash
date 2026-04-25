/**
 * Deterministic PTY session ID.
 *
 * Format: `<projectId>:<scopeId>:<leafId>` where leafId is either a
 * conversationId (agent sessions) or a terminalId (shell sessions).
 *
 * There is at most one active PTY per leaf entity.  Using a deterministic ID
 * means the renderer can subscribe to ptyDataChannel BEFORE calling
 * rpc.conversations.startSession / rpc.terminals.createTerminal — no extra
 * round-trip is needed to learn the session ID.
 */
export function makePtySessionId(projectId: string, scopeId: string, leafId: string): string {
  return `${projectId}:${scopeId}:${leafId}`;
}
