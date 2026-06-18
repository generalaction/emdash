import type { CanonicalHookEvent } from '@emdash/core/agents/plugins';
import { defaultHookEventParser } from '@emdash/core/agents/plugins/helpers';
import { eq } from 'drizzle-orm';
import { getPlugin } from '@main/core/agents/plugin-registry';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import type { AgentEvent } from '@shared/core/agents/agentEvents';
import { parsePtyId } from '@shared/core/pty/ptyId';
import type { RawHookRequest } from './hook-server';

export type ConversationContext = {
  conversationId: string;
  taskId: string;
  projectId: string;
  providerId: string;
  ptyId: string;
};

export type ParsedHookEvent =
  | { kind: 'status'; event: AgentEvent }
  | { kind: 'session'; ctx: ConversationContext; providerSessionId: string }
  | { kind: 'ignore' };

async function resolveContext(ptyId: string): Promise<ConversationContext | null> {
  const parsed = parsePtyId(ptyId);
  if (!parsed) return null;

  const [row] = await db
    .select({ taskId: conversations.taskId, projectId: conversations.projectId })
    .from(conversations)
    .where(eq(conversations.id, parsed.conversationId))
    .limit(1);

  if (!row) return null;

  return {
    conversationId: parsed.conversationId,
    taskId: row.taskId,
    projectId: row.projectId,
    providerId: parsed.providerId,
    ptyId,
  };
}

function parseBody(raw: RawHookRequest): Record<string, unknown> {
  if (!raw.body) return {};
  try {
    const value: unknown = JSON.parse(raw.body);
    if (typeof value === 'object' && value !== null) return value as Record<string, unknown>;
  } catch {}
  return {};
}

function canonicalToAgentEvent(
  canonical: CanonicalHookEvent & { kind: 'status' },
  ctx: ConversationContext
): AgentEvent {
  return {
    type: canonical.type,
    source: 'hook',
    ptyId: ctx.ptyId,
    providerId: ctx.providerId,
    projectId: ctx.projectId,
    conversationId: ctx.conversationId,
    taskId: ctx.taskId,
    timestamp: Date.now(),
    payload: {
      notificationType: canonical.notificationType,
      title: canonical.title,
      message: canonical.message,
      lastAssistantMessage: canonical.lastAssistantMessage,
    },
  };
}

export async function parseHookEvent(raw: RawHookRequest): Promise<ParsedHookEvent> {
  const ctx = await resolveContext(raw.ptyId);
  if (!ctx) {
    throw new Error(`Unrecognised ptyId: ${raw.ptyId}`);
  }

  const body = parseBody(raw);
  const plugin = getPlugin(ctx.providerId);
  const parser = plugin?.behavior.hooks?.parseHookEvent ?? defaultHookEventParser;
  const canonical = parser(raw.type, body);

  if (canonical.kind === 'ignore') return { kind: 'ignore' };

  if (canonical.kind === 'session') {
    return { kind: 'session', ctx, providerSessionId: canonical.providerSessionId };
  }

  return { kind: 'status', event: canonicalToAgentEvent(canonical, ctx) };
}
