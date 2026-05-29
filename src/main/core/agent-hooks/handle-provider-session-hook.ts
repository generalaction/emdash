import { saveProviderSessionId } from '@main/core/conversations/save-provider-session-id';
import { log } from '@main/lib/logger';
import { parsePtyId } from '@shared/ptyId';
import type { RawHookRequest } from './hook-server';

export async function handleProviderSessionHook(raw: RawHookRequest): Promise<void> {
  const parsed = parsePtyId(raw.ptyId);
  if (!parsed || parsed.providerId !== 'droid') return;

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

  const providerSessionId = body.session_id ?? body.provider_session_id ?? body.providerSessionId;
  if (typeof providerSessionId !== 'string' || providerSessionId.length === 0) return;

  await saveProviderSessionId(parsed.conversationId, providerSessionId);
}
