import { HookCore, type Hookable } from '@main/lib/hookable';
import { log } from '@main/lib/logger';
import type { AgentProviderId } from '@shared/core/agents/agent-provider-registry';
import type { Conversation } from '@shared/core/conversations/conversations';

export type ConversationCrudHooks = {
  'conversation:created': (conversation: Conversation) => void | Promise<void>;
  'conversation:renamed': (
    conversationId: string,
    projectId: string,
    taskId: string,
    newTitle: string
  ) => void | Promise<void>;
  'conversation:deleted': (conversationId: string) => void | Promise<void>;
  'conversation:input-submitted': (params: {
    projectId: string;
    taskId: string;
    conversationId: string;
    providerId: AgentProviderId;
  }) => void | Promise<void>;
};

class ConversationEvents implements Hookable<ConversationCrudHooks> {
  private readonly _core = new HookCore<ConversationCrudHooks>((name, e) =>
    log.error(`ConversationEvents: ${String(name)} hook error`, e)
  );

  on<K extends keyof ConversationCrudHooks>(name: K, handler: ConversationCrudHooks[K]) {
    return this._core.on(name, handler);
  }

  _emit<K extends keyof ConversationCrudHooks>(
    name: K,
    ...args: Parameters<ConversationCrudHooks[K]>
  ): void {
    this._core.callHookBackground(name, ...args);
  }
}

export const conversationEvents = new ConversationEvents();
