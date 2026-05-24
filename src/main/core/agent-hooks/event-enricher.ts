import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import type { AgentEvent } from '@shared/events/agentEvents';
import { parsePtyId } from '@shared/ptyId';
import type { RawHookRequest } from './hook-server';
import { normalizePayload } from './payload-normalizer';

export async function enrichEvent(raw: RawHookRequest): Promise<AgentEvent> {
  const parsed = parsePtyId(raw.ptyId);
  if (!parsed) {
    throw new Error(`Unrecognised ptyId: ${raw.ptyId}`);
  }

  const [convRows] = await db
    .select({ taskId: conversations.taskId, projectId: conversations.projectId })
    .from(conversations)
    .where(eq(conversations.id, parsed.conversationId))
    .limit(1);

  const taskId = convRows.taskId;
  const projectId = convRows.projectId;
  const body = raw.body ? JSON.parse(raw.body) : {};
  const payload = normalizePayload(parsed.providerId, raw.type, body);

  return {
    type: raw.type as AgentEvent['type'],
    ptyId: raw.ptyId,
    providerId: parsed.providerId,
    projectId,
    conversationId: parsed.conversationId,
    taskId,
    timestamp: Date.now(),
    payload,
  };
}
