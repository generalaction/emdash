import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  getProvider,
  isValidProviderId,
  type AgentProviderId,
} from '@shared/agent-provider-registry';
import type { AgentEvent } from '@shared/events/agentEvents';
import { makePtySessionId } from '@shared/ptySessionId';
import { createConversation } from '@main/core/conversations/createConversation';
import { getConversationById } from '@main/core/conversations/getConversationById';
import {
  getTranscriptReader,
  isTranscriptSupported,
} from '@main/core/conversations/provider-session';
import { mapConversationRowToConversation } from '@main/core/conversations/utils';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import type { AgentEventBuffer } from '../event-buffer';
import { HttpError, type CallerContext } from '../http-server';

export type AgentStatus = 'unknown' | 'working' | 'awaiting-input' | 'error' | 'idle';
export type ProviderTier = 'hooks' | 'classifier' | 'unsupported';

interface SelfResponse {
  conversationId: string;
  taskId: string;
  projectId: string;
  providerId: string;
  name: string;
}

interface ObserveResponse {
  status: AgentStatus;
  recentEvents: AgentEvent[];
  lastAssistantMessage?: string;
  providerTier: ProviderTier;
  statusChangedAt: number | null;
}

const DEFAULT_LONG_POLL_MS = 30_000;
const MAX_LONG_POLL_MS = 60_000;
const MIN_LONG_POLL_MS = 1_000;

function deriveStatus(events: AgentEvent[]): AgentStatus {
  if (events.length === 0) return 'unknown';
  const last = events[events.length - 1];
  if (last.type === 'error') return 'error';
  if (last.type === 'stop') return 'idle';
  if (last.type === 'notification') {
    const nt = last.payload.notificationType;
    if (nt === 'permission_prompt' || nt === 'idle_prompt' || nt === 'elicitation_dialog') {
      return 'awaiting-input';
    }
    return 'working';
  }
  return 'working';
}

function deriveProviderTier(providerId: string): ProviderTier {
  const provider = getProvider(providerId as never);
  if (!provider) return 'unsupported';
  return provider.supportsHooks ? 'hooks' : 'classifier';
}

export async function handleAgentSelf(caller: CallerContext): Promise<SelfResponse> {
  return {
    conversationId: caller.conversation.id,
    taskId: caller.conversation.taskId,
    projectId: caller.conversation.projectId,
    providerId: caller.conversation.providerId,
    name: caller.conversation.title,
  };
}

export async function handleAgentObserve(
  caller: CallerContext,
  targetConversationId: string,
  query: { waitForChange?: boolean; timeoutMs?: number },
  buffer: AgentEventBuffer
): Promise<ObserveResponse> {
  const target = await getConversationById(targetConversationId);
  if (!target) throw new HttpError(410, 'conversation gone');

  // Cross-task reads are always allowed — visibility is cheap.
  void caller;

  if (query.waitForChange) {
    const timeoutMs = Math.min(
      Math.max(query.timeoutMs ?? DEFAULT_LONG_POLL_MS, MIN_LONG_POLL_MS),
      MAX_LONG_POLL_MS
    );
    const since = buffer.getState(targetConversationId)?.lastAt ?? 0;
    await buffer.waitForChange(targetConversationId, since, timeoutMs);
  }

  const state = buffer.getState(targetConversationId);
  const recent = state?.recent ?? [];
  return {
    status: deriveStatus(recent),
    recentEvents: recent,
    lastAssistantMessage: state?.lastAssistantMessage,
    providerTier: deriveProviderTier(target.providerId),
    statusChangedAt: state?.lastAt ?? null,
  };
}

export async function handleAgentSend(
  caller: CallerContext,
  targetConversationId: string,
  body: { message: string; crossTask?: boolean; submit?: boolean }
): Promise<{ ok: true }> {
  if (typeof body.message !== 'string' || body.message.length === 0) {
    throw new HttpError(400, 'message must be non-empty string');
  }

  const target = await getConversationById(targetConversationId);
  if (!target) throw new HttpError(410, 'conversation gone');

  if (target.taskId !== caller.conversation.taskId && !body.crossTask) {
    throw new HttpError(403, 'cross-task send requires crossTask=true');
  }

  const sessionId = makePtySessionId(target.projectId, target.taskId, target.id);
  const pty = ptySessionRegistry.get(sessionId);
  if (!pty) throw new HttpError(410, 'pty not running');

  // Send the message text, then optionally an Enter keypress.
  //
  // submit=true (default) appends \r (carriage return) — the key TUIs
  // like Claude Code interpret as Enter / submit. \n (LF) would insert a
  // newline within the input box on those agents, which is why earlier
  // code that appended \n caused the message to be typed but never sent.
  // submit=false leaves the message staged as a draft for the user.
  pty.write(body.message);
  if ((body.submit ?? true) === true) {
    pty.write('\r');
  }
  return { ok: true };
}

interface PeerSummary {
  conversationId: string;
  taskId: string;
  projectId: string;
  providerId: string;
  name: string;
  status: AgentStatus;
  lastActivityAt: string | null;
}

export async function handleAgentListPeers(
  caller: CallerContext,
  scope: 'task' | 'project' | 'all',
  buffer: AgentEventBuffer
): Promise<PeerSummary[]> {
  let rows;
  if (scope === 'task') {
    rows = await db
      .select()
      .from(conversations)
      .where(eq(conversations.taskId, caller.conversation.taskId));
  } else if (scope === 'project') {
    rows = await db
      .select()
      .from(conversations)
      .where(eq(conversations.projectId, caller.conversation.projectId));
  } else {
    rows = await db.select().from(conversations);
  }

  const peers: PeerSummary[] = [];
  for (const row of rows) {
    if (row.id === caller.conversation.id) continue;
    const c = mapConversationRowToConversation(row);
    const state = buffer.getState(c.id);
    peers.push({
      conversationId: c.id,
      taskId: c.taskId,
      projectId: c.projectId,
      providerId: c.providerId,
      name: c.title,
      status: deriveStatus(state?.recent ?? []),
      lastActivityAt: c.lastInteractedAt,
    });
  }
  return peers;
}

interface SpawnBody {
  providerId: string;
  name?: string;
  initialPrompt?: string;
  sameTask?: boolean;
}

export async function handleAgentSpawn(
  caller: CallerContext,
  body: SpawnBody
): Promise<{ conversationId: string }> {
  if (body.sameTask === false) {
    throw new HttpError(
      400,
      'sameTask=false not supported. Use task_create (PR4) to spawn an agent in a new task.'
    );
  }
  if (!body.providerId || !isValidProviderId(body.providerId)) {
    throw new HttpError(400, 'invalid providerId');
  }
  const provider = body.providerId as AgentProviderId;
  const id = randomUUID();
  const conv = await createConversation({
    id,
    projectId: caller.conversation.projectId,
    taskId: caller.conversation.taskId,
    provider,
    title: body.name ?? getProvider(provider)?.name ?? provider,
    isInitialConversation: false,
    initialPrompt: body.initialPrompt,
  });
  return { conversationId: conv.id };
}

export async function handleAgentInterrupt(
  caller: CallerContext,
  targetConversationId: string,
  body: { crossTask?: boolean }
): Promise<{ ok: true }> {
  const target = await getConversationById(targetConversationId);
  if (!target) throw new HttpError(410, 'conversation gone');

  if (target.taskId !== caller.conversation.taskId && !body.crossTask) {
    throw new HttpError(403, 'cross-task interrupt requires crossTask=true');
  }

  const sessionId = makePtySessionId(target.projectId, target.taskId, target.id);
  const pty = ptySessionRegistry.get(sessionId);
  if (!pty) throw new HttpError(410, 'pty not running');

  pty.write('\x03');
  return { ok: true };
}

interface FetchResponse {
  items: AgentEvent[] | string | unknown[];
  nextCursor?: string;
  providerTier: ProviderTier;
  transcriptSupported: boolean;
}

export async function handleAgentFetch(
  caller: CallerContext,
  targetConversationId: string,
  query: { kind?: string; limit?: number; since?: string },
  buffer: AgentEventBuffer
): Promise<FetchResponse> {
  const target = await getConversationById(targetConversationId);
  if (!target) throw new HttpError(410, 'conversation gone');

  // Cross-task reads are always allowed (visibility is cheap).
  void caller;

  const kind = query.kind ?? 'events';
  const tier = deriveProviderTier(target.providerId);
  const transcriptSupported = isTranscriptSupported(target.providerId);

  if (kind === 'events') {
    const since = query.since ? Number(query.since) : undefined;
    const events = buffer.getEvents(target.id, Number.isFinite(since) ? since : undefined);
    const limited = query.limit ? events.slice(-Math.max(1, Math.floor(query.limit))) : events;
    const last = limited[limited.length - 1];
    return {
      items: limited,
      nextCursor: last ? String(last.timestamp) : undefined,
      providerTier: tier,
      transcriptSupported,
    };
  }

  if (kind === 'scrollback') {
    const sessionId = makePtySessionId(target.projectId, target.taskId, target.id);
    const buf = ptySessionRegistry.peekRingBuffer(sessionId);
    const limit = query.limit && query.limit > 0 ? Math.floor(query.limit) : undefined;
    const items = limit && buf.length > limit ? buf.slice(-limit) : buf;
    return { items, providerTier: tier, transcriptSupported };
  }

  if (kind === 'transcript') {
    const reader = getTranscriptReader(target.providerId);
    if (!reader) {
      return { items: [], providerTier: tier, transcriptSupported: false };
    }
    if (!target.externalSessionId) {
      // Capture still pending (or unsupported for this provider/launch).
      // Return empty with transcriptSupported=true so caller can retry.
      return { items: [], providerTier: tier, transcriptSupported };
    }
    const result = await reader.fetch({
      externalSessionId: target.externalSessionId,
      externalSourcePath: target.externalSourcePath ?? null,
      ...(query.limit ? { limit: Math.floor(query.limit) } : {}),
      ...(query.since ? { since: query.since } : {}),
    });
    return {
      items: result.items,
      ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
      providerTier: tier,
      transcriptSupported,
    };
  }

  throw new HttpError(400, `unknown kind: ${kind}`);
}
