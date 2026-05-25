export function extractCodexProviderSessionId(body: Record<string, unknown>): string | undefined {
  const candidates = [body.session_id, body.resource_id, body.resourceId, body.sessionId];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return undefined;
}
