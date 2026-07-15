import { isAttentionNotification } from '@emdash/core/runtimes/tui-agents/api';
import { eq } from 'drizzle-orm';
import { db } from '@main/db/client';
import { conversations } from '@main/db/schema';
import { events } from '@main/lib/events';
import { HookCore, type Hookable } from '@main/lib/hookable';
import { log } from '@main/lib/logger';
import { type AgentEvent, type AgentStatus } from '@shared/core/agents/agentEvents';
import { conversationAgentStatusChangedChannel } from '@shared/core/conversations/conversationEvents';

export type AgentStatusServiceHooks = {
  'agent:event': (event: AgentEvent) => void | Promise<void>;
};

export type ApplyAgentEventOptions = {
  deliver?: boolean;
  preserveSeen?: boolean;
};

function deriveAgentStatus(event: AgentEvent): AgentStatus | null {
  if (event.type === 'start') return 'working';
  if (event.type === 'stop') return 'completed';
  if (event.type === 'error') return 'error';
  if (event.type === 'notification') {
    const nt = event.payload.notificationType;
    if (!nt) return null;
    if (isAttentionNotification(nt)) return 'awaiting-input';
  }
  return null;
}

class AgentStatusService implements Hookable<AgentStatusServiceHooks> {
  private readonly observedStatuses = new Map<string, AgentStatus>();
  private readonly hooks = new HookCore<AgentStatusServiceHooks>((name, error) =>
    log.error(`AgentStatusService: ${String(name)} hook error`, error)
  );

  on<K extends keyof AgentStatusServiceHooks>(name: K, handler: AgentStatusServiceHooks[K]) {
    return this.hooks.on(name, handler);
  }

  async applyAgentEvent(event: AgentEvent, options: ApplyAgentEventOptions = {}): Promise<void> {
    const deliver = options.deliver ?? true;
    if (deliver) {
      this.hooks.callHookBackground('agent:event', event);
    }

    const status = deriveAgentStatus(event);
    if (!status) return;
    const derivedSeen = status === 'idle' || status === 'working' ? 1 : 0;

    const previousObservedStatus = this.observedStatuses.get(event.conversationId);
    this.observedStatuses.set(event.conversationId, status);
    const [current] =
      previousObservedStatus === undefined
        ? await db
            .select({
              agentStatus: conversations.agentStatus,
              agentStatusSeen: conversations.agentStatusSeen,
            })
            .from(conversations)
            .where(eq(conversations.id, event.conversationId))
            .limit(1)
        : [];
    const seen = options.preserveSeen ? (current?.agentStatusSeen ?? derivedSeen) : derivedSeen;

    await db
      .update(conversations)
      .set(
        options.preserveSeen
          ? { agentStatus: status }
          : { agentStatus: status, agentStatusSeen: seen }
      )
      .where(eq(conversations.id, event.conversationId));

    events.emit(conversationAgentStatusChangedChannel, {
      conversationId: event.conversationId,
      taskId: event.taskId,
      projectId: event.projectId,
      status,
      seen: seen === 1,
    });
  }

  async cacheAgentEvent(event: AgentEvent): Promise<void> {
    await this.applyAgentEvent(event, { deliver: false, preserveSeen: true });
  }

  async resetToIdle(params: {
    conversationId: string;
    taskId: string;
    projectId?: string;
  }): Promise<void> {
    const [row] = await db
      .select({ agentStatus: conversations.agentStatus, projectId: conversations.projectId })
      .from(conversations)
      .where(eq(conversations.id, params.conversationId))
      .limit(1);

    if (!row || (row.agentStatus !== 'working' && row.agentStatus !== 'awaiting-input')) return;

    const projectId = params.projectId ?? row.projectId;
    await db
      .update(conversations)
      .set({ agentStatus: 'idle', agentStatusSeen: 1 })
      .where(eq(conversations.id, params.conversationId));
    this.observedStatuses.set(params.conversationId, 'idle');

    events.emit(conversationAgentStatusChangedChannel, {
      conversationId: params.conversationId,
      taskId: params.taskId,
      projectId,
      status: 'idle',
      seen: true,
    });
  }

  forget(conversationId: string): void {
    this.observedStatuses.delete(conversationId);
  }

  dispose(): void {
    this.observedStatuses.clear();
  }
}

export const agentStatusService = new AgentStatusService();
