import { conversationEvents } from '@main/core/conversations/conversation-events';
import { events } from '@main/lib/events';
import {
  type ConversationPermissionResponse,
  type SendConversationMessageInput,
  type SendConversationMessageResult,
} from '@shared/conversation-timeline';
import type { Conversation } from '@shared/conversations';
import type { AgentEvent } from '@shared/events/agentEvents';
import { conversationStatusEventChannel } from '@shared/events/conversationEvents';
import { buildPromptInjectionPayload } from '@shared/prompt-injection';
import { resolveTask } from '../../projects/utils';
import { chatTimelineStore } from './chat-timeline-store';

type ActiveChatConversation = {
  conversation: Conversation;
  lastAssistantMessage?: string;
};

export class ChatConversationRuntime {
  private readonly activeConversations = new Map<string, ActiveChatConversation>();

  async startConversation(conversation: Conversation, initialPrompt?: string): Promise<void> {
    await this.activateConversation(conversation);

    try {
      if (initialPrompt?.trim()) {
        await chatTimelineStore.appendUserMessage(conversation, initialPrompt);
        this.emitInputSubmitted(conversation);
        events.emit(conversationStatusEventChannel, {
          projectId: conversation.projectId,
          taskId: conversation.taskId,
          conversationId: conversation.id,
          status: 'working',
        });
      }
    } catch (error) {
      this.dehydrateConversation(conversation.id);
      throw error;
    }
  }

  async hydrateConversation(conversation: Conversation): Promise<void> {
    await this.activateConversation(conversation);
  }

  dehydrateConversation(conversationId: string): void {
    this.activeConversations.delete(conversationId);
  }

  isActive(conversationId: string): boolean {
    return this.activeConversations.has(conversationId);
  }

  async sendMessage(
    projectId: string,
    taskId: string,
    conversationId: string,
    input: SendConversationMessageInput
  ): Promise<SendConversationMessageResult> {
    const conversation = await this.requireActiveConversation(projectId, taskId, conversationId);
    const backend = this.getBackendProvider(conversation);
    const text = input.text.trim();
    if (!text) throw new Error('Message text is required');
    const item = await chatTimelineStore.appendUserMessage(conversation, { ...input, text });
    const active = this.activeConversations.get(conversationId);
    if (active) {
      active.lastAssistantMessage = undefined;
    }
    try {
      await this.writePromptToBackend(conversation, backend, text);
    } catch (error) {
      await chatTimelineStore.append(conversation, {
        kind: 'error',
        payload: { message: 'Failed to send message to the agent backend' },
      });
      throw error;
    }
    this.emitInputSubmitted(conversation);
    events.emit(conversationStatusEventChannel, {
      projectId,
      taskId,
      conversationId,
      status: 'working',
    });
    return { item };
  }

  async cancelTurn(projectId: string, taskId: string, conversationId: string): Promise<void> {
    const conversation = await this.requireActiveConversation(projectId, taskId, conversationId);
    await this.getBackendProvider(conversation).interruptSession(conversation.id);
    events.emit(conversationStatusEventChannel, {
      projectId,
      taskId,
      conversationId,
      status: 'idle',
    });
  }

  async respondToPermission(
    projectId: string,
    taskId: string,
    conversationId: string,
    _response: ConversationPermissionResponse
  ): Promise<void> {
    await this.requireActiveConversation(projectId, taskId, conversationId);
    throw new Error('Permission responses are not supported by the chat runtime yet');
  }

  async recordAgentEvent(event: AgentEvent): Promise<void> {
    const active = this.activeConversations.get(event.conversationId);
    if (
      !active ||
      active.conversation.projectId !== event.projectId ||
      active.conversation.taskId !== event.taskId
    ) {
      return;
    }

    const lastAssistantMessage = event.payload.lastAssistantMessage?.trim();
    if (lastAssistantMessage && lastAssistantMessage !== active.lastAssistantMessage) {
      await chatTimelineStore.append(active.conversation, {
        kind: 'assistant_message',
        payload: { text: lastAssistantMessage },
      });
      active.lastAssistantMessage = lastAssistantMessage;
    }

    if (event.type === 'error') {
      await chatTimelineStore.append(active.conversation, {
        kind: 'error',
        payload: { message: event.payload.message ?? 'Agent reported an error' },
      });
    }
  }

  dehydrateTask(taskId: string): void {
    for (const [conversationId, active] of this.activeConversations) {
      if (active.conversation.taskId === taskId) {
        this.activeConversations.delete(conversationId);
      }
    }
  }

  private getBackendProvider(conversation: Conversation) {
    const task = resolveTask(conversation.projectId, conversation.taskId);
    if (!task) {
      events.emit(conversationStatusEventChannel, {
        projectId: conversation.projectId,
        taskId: conversation.taskId,
        conversationId: conversation.id,
        status: 'error',
      });
      throw new Error('Task not found');
    }
    return task.conversations;
  }

  private async activateConversation(conversation: Conversation): Promise<void> {
    this.activeConversations.set(conversation.id, {
      conversation,
      lastAssistantMessage: await chatTimelineStore.getLatestAssistantMessage(conversation.id),
    });
  }

  private async writePromptToBackend(
    conversation: Conversation,
    backend: ReturnType<typeof this.getBackendProvider>,
    text: string
  ): Promise<void> {
    const payload = buildPromptInjectionPayload({
      providerId: conversation.providerId,
      text,
    });
    try {
      await backend.sendInput(conversation.id, `${payload}\r`);
    } catch (error) {
      events.emit(conversationStatusEventChannel, {
        projectId: conversation.projectId,
        taskId: conversation.taskId,
        conversationId: conversation.id,
        status: 'error',
      });
      throw error;
    }
  }

  private emitInputSubmitted(conversation: Conversation): void {
    conversationEvents._emit('conversation:input-submitted', {
      projectId: conversation.projectId,
      taskId: conversation.taskId,
      conversationId: conversation.id,
      providerId: conversation.providerId,
    });
  }

  private async requireActiveConversation(
    projectId: string,
    taskId: string,
    conversationId: string
  ): Promise<Conversation> {
    const conversation = await chatTimelineStore.requireChatConversation(
      projectId,
      taskId,
      conversationId
    );
    const active = this.activeConversations.get(conversationId);
    if (
      !active ||
      active.conversation.projectId !== projectId ||
      active.conversation.taskId !== taskId
    ) {
      throw new Error('Conversation chat runtime is not active');
    }
    return conversation;
  }
}

export const chatConversationRuntime = new ChatConversationRuntime();
