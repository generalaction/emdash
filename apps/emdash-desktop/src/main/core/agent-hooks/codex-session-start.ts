import { setProviderSessionId } from '@main/core/conversations/set-provider-session-id';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { conversationChangedChannel } from '@shared/core/conversations/conversationEvents';
import { enrichEvent } from './event-enricher';
import type { RawHookRequest } from './hook-server';

export async function handleCodexSessionStartHook(raw: RawHookRequest): Promise<void> {
  try {
    const event = await enrichEvent(raw);
    if (event.providerId !== 'codex') return;

    const body = raw.body ? (JSON.parse(raw.body) as Record<string, unknown>) : {};
    const providerSessionId = extractCodexProviderSessionId(body);
    if (!providerSessionId) return;

    const updated = await setProviderSessionId(event.conversationId, providerSessionId);
    if (!updated) return;

    events.emit(conversationChangedChannel, {
      conversationId: event.conversationId,
      taskId: event.taskId,
      projectId: event.projectId,
      changes: { providerSessionId },
    });
  } catch (error) {
    log.warn('CodexSessionStart: failed to persist session id', {
      ptyId: raw.ptyId,
      error: String(error),
    });
  }
}

export function extractCodexProviderSessionId(body: Record<string, unknown>): string | undefined {
  const candidates = [body.session_id, body.resource_id, body.resourceId, body.sessionId];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return undefined;
}
