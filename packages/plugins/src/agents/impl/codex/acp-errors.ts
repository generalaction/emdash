/** Codex ACP wraps app-server's missing rollout response in a generic JSON-RPC error. */
export function isCodexSessionNotFound(error: unknown, sessionId: string): boolean {
  if (!error || typeof error !== 'object' || !('code' in error) || error.code !== -32603) {
    return false;
  }
  const data = 'data' in error ? error.data : undefined;
  return (
    data !== null &&
    typeof data === 'object' &&
    'details' in data &&
    data.details === `no rollout found for thread id ${sessionId}`
  );
}
