import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  getProvider,
  isValidProviderId,
  type AgentProviderId,
} from '@shared/agent-provider-registry';
import type { Conversation } from '@shared/conversations';
import type { AgentEvent } from '@shared/events/agentEvents';
import { makePtySessionId } from '@shared/ptySessionId';
import { createConversation } from '@main/core/conversations/createConversation';
import { getConversationById } from '@main/core/conversations/getConversationById';
import {
  getTranscriptReader,
  isTranscriptSupported,
} from '@main/core/conversations/provider-session/manifest';
import type { TranscriptItem } from '@main/core/conversations/provider-session/types';
import { mapConversationRowToConversation } from '@main/core/conversations/utils';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { db } from '@main/db/client';
import { conversations, projects, tasks } from '@main/db/schema';
import type { AgentEventBuffer } from '../event-buffer';
import { HttpError, type CallerContext } from '../http-server';

// ---------- Constants ----------

const DEFAULT_LONG_POLL_MS = 15_000;
export const MAX_LONG_POLL_MS = 60_000;
export const MIN_LONG_POLL_MS = 1_000;

// ---------- Domain types ----------

export type AgentStatus = 'unknown' | 'working' | 'awaiting-input' | 'error' | 'idle';
export type ProviderTier = 'hooks' | 'classifier' | 'unsupported';

// Opaque cursor for event pagination. Currently encodes a millisecond
// timestamp, but callers must treat the value as a black box and only feed it
// back via `since`.
export type EventCursor = string & { readonly __brand: 'EventCursor' };
const encodeCursor = (timestampMs: number): EventCursor => String(timestampMs) as EventCursor;
const decodeCursor = (cursor: string | undefined): number | undefined => {
  if (cursor === undefined) return undefined;
  const n = Number(cursor);
  return Number.isFinite(n) ? n : undefined;
};

// ---------- Wire schemas (single source of truth at the HTTP boundary) ----------

export const ScopeSchema = z.enum(['task', 'project', 'all']);
export type Scope = z.infer<typeof ScopeSchema>;

export const FetchKindSchema = z.enum(['events', 'scrollback', 'transcript']);
export type FetchKind = z.infer<typeof FetchKindSchema>;

export const SpawnBodySchema = z.object({
  providerId: z.string(),
  name: z.string().optional(),
  initialPrompt: z.string().optional(),
  // v1: only same-task spawn. Cross-task spawn lands in PR4 via task_create,
  // so the schema rejects `false` instead of carrying an unsupported branch.
  sameTask: z.literal(true).optional(),
});
export type SpawnBody = z.infer<typeof SpawnBodySchema>;

export const SendBodySchema = z.object({
  message: z.string().min(1),
  crossTask: z.boolean().optional(),
  // Append a CR (\r) after the message text to submit. Default true.
  // false leaves the message staged as a draft for the user.
  submit: z.boolean().optional(),
});
export type SendBody = z.infer<typeof SendBodySchema>;

export const InterruptBodySchema = z.object({
  crossTask: z.boolean().optional(),
});
export type InterruptBody = z.infer<typeof InterruptBodySchema>;

export const ObserveQuerySchema = z.object({
  waitForChange: z.boolean().optional(),
  timeoutMs: z.number().int().min(MIN_LONG_POLL_MS).max(MAX_LONG_POLL_MS).optional(),
});
export type ObserveQuery = z.infer<typeof ObserveQuerySchema>;

export const FetchQuerySchema = z.object({
  kind: FetchKindSchema.optional(),
  limit: z.number().int().positive().optional(),
  since: z.string().min(1).optional(),
});
export type FetchQuery = z.infer<typeof FetchQuerySchema>;

// ---------- Response shapes ----------

interface SelfResponse {
  conversationId: string;
  taskId: string;
  taskName?: string;
  projectId: string;
  projectName?: string;
  providerId: string;
  name: string;
}

async function lookupNames(
  taskIds: string[],
  projectIds: string[]
): Promise<{ taskNames: Map<string, string>; projectNames: Map<string, string> }> {
  const [taskRows, projectRows] = await Promise.all([
    taskIds.length
      ? db.select({ id: tasks.id, name: tasks.name }).from(tasks).where(inArray(tasks.id, taskIds))
      : Promise.resolve([] as Array<{ id: string; name: string }>),
    projectIds.length
      ? db
          .select({ id: projects.id, name: projects.name })
          .from(projects)
          .where(inArray(projects.id, projectIds))
      : Promise.resolve([] as Array<{ id: string; name: string }>),
  ]);
  return {
    taskNames: new Map(taskRows.map((r) => [r.id, r.name])),
    projectNames: new Map(projectRows.map((r) => [r.id, r.name])),
  };
}

interface ObserveResponse {
  status: AgentStatus;
  recentEvents: AgentEvent[];
  lastAssistantMessage?: string;
  providerTier: ProviderTier;
  statusChangedAt: number | null;
}

interface PeerSummary {
  conversationId: string;
  taskId: string;
  taskName?: string;
  projectId: string;
  projectName?: string;
  providerId: string;
  name: string;
  status: AgentStatus;
  lastActivityAt: string | null;
}

// Discriminated by `kind` so callers branch on a single field instead of
// sniffing the shape of `items`.
export type FetchResponse =
  | {
      kind: 'events';
      events: AgentEvent[];
      nextCursor?: EventCursor;
      providerTier: ProviderTier;
      transcriptSupported: boolean;
    }
  | {
      kind: 'scrollback';
      scrollback: string;
      providerTier: ProviderTier;
      transcriptSupported: boolean;
    }
  | {
      kind: 'transcript';
      items: TranscriptItem[];
      nextCursor?: string;
      providerTier: ProviderTier;
      transcriptSupported: boolean;
    };

// ---------- Pure helpers ----------

/**
 * Statuses where waiting for a "change" doesn't make sense — the peer is
 * already at rest. waitForChange should short-circuit on these so a caller
 * polling after the agent emitted `stop` doesn't block for nothing.
 */
const TERMINAL_STATUSES: ReadonlySet<AgentStatus> = new Set(['idle', 'error', 'awaiting-input']);

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

// Single source of truth for cross-task write gating. Reads are always
// allowed in callers; writes (send/interrupt) require `crossTask:true` to
// cross the task boundary.
function assertCrossTaskWrite(
  caller: CallerContext,
  target: Conversation,
  crossTask: boolean | undefined,
  op: 'send' | 'interrupt'
): void {
  if (target.taskId === caller.conversation.taskId) return;
  if (crossTask) return;
  throw new HttpError(403, `cross-task ${op} requires crossTask=true`);
}

async function loadTargetConversation(targetConversationId: string): Promise<Conversation> {
  const target = await getConversationById(targetConversationId);
  if (!target) throw new HttpError(410, 'conversation gone');
  return target;
}

async function selectPeerRows(caller: CallerContext, scope: Scope) {
  switch (scope) {
    case 'task':
      return db
        .select()
        .from(conversations)
        .where(eq(conversations.taskId, caller.conversation.taskId));
    case 'project':
      return db
        .select()
        .from(conversations)
        .where(eq(conversations.projectId, caller.conversation.projectId));
    case 'all':
      return db.select().from(conversations);
  }
}

// ---------- Handlers ----------

export async function handleAgentSelf(caller: CallerContext): Promise<SelfResponse> {
  const { taskNames, projectNames } = await lookupNames(
    [caller.conversation.taskId],
    [caller.conversation.projectId]
  );
  return {
    conversationId: caller.conversation.id,
    taskId: caller.conversation.taskId,
    taskName: taskNames.get(caller.conversation.taskId),
    projectId: caller.conversation.projectId,
    projectName: projectNames.get(caller.conversation.projectId),
    providerId: caller.conversation.providerId,
    name: caller.conversation.title,
  };
}

export async function handleAgentObserve(
  caller: CallerContext,
  targetConversationId: string,
  query: ObserveQuery,
  buffer: AgentEventBuffer
): Promise<ObserveResponse> {
  const target = await loadTargetConversation(targetConversationId);
  void caller; // cross-task reads are always allowed; visibility is cheap

  if (query.waitForChange) {
    const state = buffer.getState(targetConversationId);
    const currentStatus = deriveStatus(state?.recent ?? []);
    // If peer already at rest, "change" caller waits on already happened.
    // Return immediately instead of blocking timeoutMs.
    if (!TERMINAL_STATUSES.has(currentStatus)) {
      const timeoutMs = Math.min(
        Math.max(query.timeoutMs ?? DEFAULT_LONG_POLL_MS, MIN_LONG_POLL_MS),
        MAX_LONG_POLL_MS
      );
      const since = state?.lastAt ?? 0;
      await buffer.waitForChange(targetConversationId, since, timeoutMs);
    }
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
  body: SendBody
): Promise<{ ok: true }> {
  const target = await loadTargetConversation(targetConversationId);
  assertCrossTaskWrite(caller, target, body.crossTask, 'send');

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

export async function handleAgentListPeers(
  caller: CallerContext,
  scope: Scope,
  buffer: AgentEventBuffer
): Promise<PeerSummary[]> {
  const rows = await selectPeerRows(caller, scope);

  const filtered = rows.filter((row) => row.id !== caller.conversation.id);
  const { taskNames, projectNames } = await lookupNames(
    Array.from(new Set(filtered.map((r) => r.taskId))),
    Array.from(new Set(filtered.map((r) => r.projectId)))
  );

  return filtered.map((row) => {
    const c = mapConversationRowToConversation(row);
    const state = buffer.getState(c.id);
    return {
      conversationId: c.id,
      taskId: c.taskId,
      taskName: taskNames.get(c.taskId),
      projectId: c.projectId,
      projectName: projectNames.get(c.projectId),
      providerId: c.providerId,
      name: c.title,
      status: deriveStatus(state?.recent ?? []),
      lastActivityAt: c.lastInteractedAt,
    };
  });
}

export async function handleAgentSpawn(
  caller: CallerContext,
  body: SpawnBody
): Promise<{ conversationId: string; title: string; providerId: string }> {
  if (!isValidProviderId(body.providerId)) throw new HttpError(400, 'invalid providerId');
  const provider = body.providerId as AgentProviderId;
  const id = randomUUID();
  const title = body.name ?? getProvider(provider)?.name ?? provider;
  const conv = await createConversation({
    id,
    projectId: caller.conversation.projectId,
    taskId: caller.conversation.taskId,
    provider,
    title,
    isInitialConversation: false,
    initialPrompt: body.initialPrompt,
  });
  return { conversationId: conv.id, title: conv.title, providerId: provider };
}

export async function handleAgentInterrupt(
  caller: CallerContext,
  targetConversationId: string,
  body: InterruptBody
): Promise<{ ok: true }> {
  const target = await loadTargetConversation(targetConversationId);
  assertCrossTaskWrite(caller, target, body.crossTask, 'interrupt');

  const sessionId = makePtySessionId(target.projectId, target.taskId, target.id);
  const pty = ptySessionRegistry.get(sessionId);
  if (!pty) throw new HttpError(410, 'pty not running');

  pty.write('\x03');
  return { ok: true };
}

export async function handleAgentFetch(
  caller: CallerContext,
  targetConversationId: string,
  query: FetchQuery,
  buffer: AgentEventBuffer
): Promise<FetchResponse> {
  const target = await loadTargetConversation(targetConversationId);
  void caller; // cross-task reads are always allowed

  const kind: FetchKind = query.kind ?? 'events';
  const tier = deriveProviderTier(target.providerId);
  const transcriptSupported = isTranscriptSupported(target.providerId);

  if (kind === 'events') {
    const since = decodeCursor(query.since);
    const all = buffer.getEvents(target.id, since);
    const events = query.limit ? all.slice(-query.limit) : all;
    const last = events[events.length - 1];
    return {
      kind: 'events',
      events,
      nextCursor: last ? encodeCursor(last.timestamp) : undefined,
      providerTier: tier,
      transcriptSupported,
    };
  }

  if (kind === 'scrollback') {
    const sessionId = makePtySessionId(target.projectId, target.taskId, target.id);
    const buf = ptySessionRegistry.peekRingBuffer(sessionId);
    const scrollback = query.limit && buf.length > query.limit ? buf.slice(-query.limit) : buf;
    return {
      kind: 'scrollback',
      scrollback,
      providerTier: tier,
      transcriptSupported,
    };
  }

  // kind === 'transcript'
  const reader = getTranscriptReader(target.providerId);
  if (!reader) {
    return { kind: 'transcript', items: [], providerTier: tier, transcriptSupported: false };
  }
  if (!target.externalSessionId) {
    // Capture still pending (or unsupported for this provider/launch).
    // Return empty with transcriptSupported=true so caller can retry.
    return { kind: 'transcript', items: [], providerTier: tier, transcriptSupported };
  }
  const result = await reader.fetch({
    externalSessionId: target.externalSessionId,
    externalSourcePath: target.externalSourcePath ?? null,
    ...(query.limit ? { limit: query.limit } : {}),
    ...(query.since ? { since: query.since } : {}),
  });
  return {
    kind: 'transcript',
    items: result.items,
    ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
    providerTier: tier,
    transcriptSupported,
  };
}
