import type { Conversation } from '@shared/conversations';

type ActiveChatConversation = {
  conversation: Conversation;
  initialPrompt?: string;
};

export class ChatConversationRuntime {
  private readonly activeConversations = new Map<string, ActiveChatConversation>();

  async startConversation(conversation: Conversation): Promise<void> {
    this.activeConversations.set(conversation.id, {
      conversation,
      initialPrompt: conversation.initialPrompt,
    });
  }

  async hydrateConversation(conversation: Conversation): Promise<void> {
    this.activeConversations.set(conversation.id, {
      conversation,
      initialPrompt: conversation.initialPrompt,
    });
  }

  dehydrateConversation(conversationId: string): void {
    this.activeConversations.delete(conversationId);
  }

  isActive(conversationId: string): boolean {
    return this.activeConversations.has(conversationId);
  }

  getInitialPrompt(conversationId: string): string | undefined {
    return this.activeConversations.get(conversationId)?.initialPrompt;
  }

  dehydrateTask(taskId: string): void {
    for (const [conversationId, active] of this.activeConversations) {
      if (active.conversation.taskId === taskId) {
        this.activeConversations.delete(conversationId);
      }
    }
  }
}

export const chatConversationRuntime = new ChatConversationRuntime();
