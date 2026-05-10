import type { AgentEvent } from '@shared/events/agentEvents';
import { agentEventBus } from '@main/core/agent-hooks/agent-event-bus';

const RECENT_LIMIT = 5;

interface ConversationState {
  recent: AgentEvent[];
  lastAt: number;
  lastAssistantMessage?: string;
}

/**
 * Per-conversation in-memory ring of the most recent agent events. Subscribed
 * to the main-process bus so both hook-tier (HTTP /hook) and classifier-tier
 * (PTY scrape) sources land here. Used by /agent/{id}/observe.
 *
 * Spec §6: agent_observe.recentEvents is capped at 5.
 */
export class AgentEventBuffer {
  private readonly states = new Map<string, ConversationState>();
  private readonly waiters = new Map<string, Set<() => void>>();
  private dispose: (() => void) | null = null;

  start(): void {
    if (this.dispose) return;
    this.dispose = agentEventBus.onEvent(({ event }) => this.ingest(event));
  }

  stop(): void {
    this.dispose?.();
    this.dispose = null;
    this.states.clear();
    this.waiters.clear();
  }

  getState(conversationId: string): ConversationState | undefined {
    return this.states.get(conversationId);
  }

  /**
   * Long-poll: resolves true when a new event lands for this conversation,
   * false on timeout. Resolves immediately if `since` is older than the most
   * recent event already buffered.
   */
  waitForChange(conversationId: string, since: number, timeoutMs: number): Promise<boolean> {
    const state = this.states.get(conversationId);
    if (state && state.lastAt > since) return Promise.resolve(true);

    return new Promise((resolve) => {
      let settled = false;
      const finish = (changed: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.waiters.get(conversationId)?.delete(notify);
        resolve(changed);
      };
      const notify = () => finish(true);
      const timer = setTimeout(() => finish(false), timeoutMs);
      let set = this.waiters.get(conversationId);
      if (!set) {
        set = new Set();
        this.waiters.set(conversationId, set);
      }
      set.add(notify);
    });
  }

  private ingest(event: AgentEvent): void {
    const state = this.states.get(event.conversationId) ?? {
      recent: [] as AgentEvent[],
      lastAt: 0,
    };
    state.recent = [...state.recent, event].slice(-RECENT_LIMIT);
    state.lastAt = event.timestamp;
    if (event.payload.lastAssistantMessage) {
      state.lastAssistantMessage = event.payload.lastAssistantMessage;
    }
    this.states.set(event.conversationId, state);

    const waiters = this.waiters.get(event.conversationId);
    if (waiters && waiters.size > 0) {
      for (const w of waiters) w();
      waiters.clear();
    }
  }
}
