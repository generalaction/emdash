import { saveProviderSessionId } from '@main/core/conversations/save-provider-session-id';
import { setProviderSessionId } from '@main/core/conversations/set-provider-session-id';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { conversationChangedChannel } from '@shared/events/conversationEvents';
import { parsePtyId } from '@shared/ptyId';
import { enrichEvent } from './event-enricher';
import type { RawHookRequest } from './hook-server';

export function extractProviderSessionId(body: Record<string, unknown>): string | undefined {
  const candidates = [
    body.session_id,
    body.provider_session_id,
    body.providerSessionId,
    body.sessionId,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

function isValidProviderSessionId(providerId: string, providerSessionId: string): boolean {
  if (providerId === 'opencode') return providerSessionId.startsWith('ses');
  return true;
}

export async function handleProviderSessionHook(raw: RawHookRequest): Promise<void> {
  const parsed = parsePtyId(raw.ptyId);
  if (
    !parsed ||
    (parsed.providerId !== 'copilot' &&
      parsed.providerId !== 'droid' &&
      parsed.providerId !== 'grok' &&
      parsed.providerId !== 'opencode')
  ) {
    return;
  }

  let body: Record<string, unknown> = {};
  if (raw.body) {
    try {
      const value: unknown = JSON.parse(raw.body);
      if (typeof value === 'object' && value !== null) {
        body = value as Record<string, unknown>;
      }
    } catch {
      log.warn('handleProviderSessionHook: invalid JSON body', { ptyId: raw.ptyId });
      return;
    }
  }

  const providerSessionId = extractProviderSessionId(body);
  if (!providerSessionId) return;
  if (!isValidProviderSessionId(parsed.providerId, providerSessionId)) return;

  if (parsed.providerId === 'droid') {
    await saveProviderSessionId(parsed.conversationId, providerSessionId);
    return;
  }

  const updated = await setProviderSessionId(parsed.conversationId, providerSessionId);
  if (!updated) return;

  const event = await enrichEvent(raw);

  events.emit(conversationChangedChannel, {
    conversationId: parsed.conversationId,
    taskId: event.taskId,
    projectId: event.projectId,
    changes: { providerSessionId },
  });
}
