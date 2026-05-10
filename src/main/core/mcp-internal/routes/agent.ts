import { getProvider } from '@shared/agent-provider-registry';
import type { AgentEvent } from '@shared/events/agentEvents';
import { makePtySessionId } from '@shared/ptySessionId';
import { getConversationById } from '@main/core/conversations/getConversationById';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
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

  // PR1: same-task only. Cross-task scope arrives in PR2.
  if (target.taskId !== caller.conversation.taskId) {
    throw new HttpError(403, 'cross-task observe not enabled in v1');
  }

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
  body: { message: string; crossTask?: boolean }
): Promise<{ ok: true }> {
  if (typeof body.message !== 'string' || body.message.length === 0) {
    throw new HttpError(400, 'message must be non-empty string');
  }

  const target = await getConversationById(targetConversationId);
  if (!target) throw new HttpError(410, 'conversation gone');

  if (target.taskId !== caller.conversation.taskId) {
    // PR2 will gate this with the cross-task:write capability bucket.
    if (!body.crossTask) throw new HttpError(403, 'cross-task send requires crossTask=true');
    throw new HttpError(403, 'cross-task:write capability not enabled in v1');
  }

  const sessionId = makePtySessionId(target.projectId, target.taskId, target.id);
  const pty = ptySessionRegistry.get(sessionId);
  if (!pty) throw new HttpError(410, 'pty not running');

  pty.write(body.message.endsWith('\n') ? body.message : body.message + '\n');
  return { ok: true };
}
