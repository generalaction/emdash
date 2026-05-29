import { setProviderSessionId } from '@main/core/conversations/set-provider-session-id';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { conversationChangedChannel } from '@shared/events/conversationEvents';
import { enrichEvent } from './event-enricher';
import type { RawHookRequest } from './hook-server';

export async function handleAmpSessionStartHook(raw: RawHookRequest): Promise<void> {
  try {
    const event = await enrichEvent(raw);
    if (event.providerId !== 'amp') return;

    const body = raw.body ? (JSON.parse(raw.body) as Record<string, unknown>) : {};
    const providerSessionId = extractAmpProviderSessionId(body);
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
    log.warn('AmpSessionStart: failed to persist thread id', {
      ptyId: raw.ptyId,
      error: String(error),
    });
  }
}

export function extractAmpProviderSessionId(body: Record<string, unknown>): string | undefined {
  const candidates = [
    body.providerSessionId,
    body.provider_session_id,
    body.threadId,
    body.thread_id,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const value = candidate.trim();
    if (value.startsWith('T-')) return value;
  }

  return undefined;
}
