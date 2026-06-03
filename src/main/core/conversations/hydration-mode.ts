import { parseConversationConfig } from '@shared/conversation-config';

const PENDING_FIRST_SPAWN_WINDOW_MS = 5 * 60 * 1000;

export function shouldHydrateAsFirstSpawn(row: {
  sessionId: string | null;
  config: string | null;
  createdAt: string;
}): boolean {
  if (row.sessionId !== null) return false;

  const config = parseConversationConfig(row.config);
  if (!config.initialPrompt?.trim()) return false;

  const createdAtMs = Date.parse(row.createdAt);
  if (!Number.isFinite(createdAtMs)) return false;

  return Date.now() - createdAtMs <= PENDING_FIRST_SPAWN_WINDOW_MS;
}
