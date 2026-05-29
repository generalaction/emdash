import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import type { AgentEvent } from '@shared/events/agentEvents';
import { parsePtyId } from '@shared/ptyId';
import type { RawHookRequest } from './hook-server';

function normalizePayload(
  providerId: string,
  body: Record<string, unknown>
): AgentEvent['payload'] {
  const payload: AgentEvent['payload'] = {
    notificationType: (body.notification_type ??
      body.notificationType) as AgentEvent['payload']['notificationType'],
    requestId: (body.request_id ?? body.requestId) as string | undefined,
    lastAssistantMessage: (body.last_assistant_message ?? body.lastAssistantMessage) as
      | string
      | undefined,
    title: body.title as string | undefined,
    message: body.message as string | undefined,
    toolCallId: (body.tool_call_id ?? body.toolCallId) as string | undefined,
    toolName: (body.tool_name ?? body.toolName) as string | undefined,
    toolStatus: (body.tool_status ?? body.toolStatus) as AgentEvent['payload']['toolStatus'],
    toolInput: body.tool_input ?? body.toolInput,
    toolOutput: (body.tool_output ?? body.toolOutput) as string | undefined,
    toolError: (body.tool_error ?? body.toolError) as string | undefined,
  };

  if (!payload.notificationType && providerId === 'codex' && body.type === 'agent-turn-complete') {
    payload.notificationType = 'idle_prompt';
  }

  return payload;
}

function parseHookBody(rawBody: string): Record<string, unknown> {
  if (!rawBody.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
    if (typeof parsed === 'string' && parsed.trim()) {
      return { lastAssistantMessage: parsed };
    }
    return {};
  } catch {
    return { lastAssistantMessage: rawBody };
  }
}

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
  const body = parseHookBody(raw.body);
  const payload = normalizePayload(parsed.providerId, body);

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
