import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import {
  type ConversationMessageTimelineItem,
  type ConversationPermissionResponse,
  type ConversationStatus,
  type SendConversationMessageInput,
  type SendConversationMessageResult,
} from '@shared/conversation-timeline';
import type { Conversation } from '@shared/conversations';
import {
  conversationChangedChannel,
  conversationStatusEventChannel,
} from '@shared/events/conversationEvents';
import { resolveTask } from '../../projects/utils';
import { conversationEvents } from '../conversation-events';
import { setProviderSessionId } from '../set-provider-session-id';
import { chatTimelineStore } from './chat-timeline-store';
import { getChatProviderAdapter } from './provider-adapters';
import type {
  AgentSlashCommand,
  AgentSlashCommandInput,
  ChatProviderAdapter,
  ChatProviderRuntimeEvent,
  ChatProviderSession,
} from './types';

type ActiveChatConversation = {
  adapter: ChatProviderAdapter;
  awaitingInput: boolean;
  awaitingResponse: boolean;
  conversation: Conversation;
  session: ChatProviderSession;
};

export class ChatConversationRuntime {
  private readonly activeConversations = new Map<string, ActiveChatConversation>();

  async startConversation(conversation: Conversation, initialPrompt?: string): Promise<void> {
    await this.activateConversation(conversation, { resume: false });
    const text = initialPrompt?.trim();
    if (!text) return;

    try {
      await this.sendMessage(conversation.projectId, conversation.taskId, conversation.id, {
        text,
      });
    } catch (error) {
      await this.dehydrateConversation(conversation.id, { restoreHydrationRecovery: false });
      throw error;
    }
  }

  async hydrateConversation(conversation: Conversation): Promise<void> {
    const active = this.activeConversations.get(conversation.id);
    if (active) {
      active.conversation = conversation;
      return;
    }
    await this.activateConversation(conversation, { resume: true });
  }

  async dehydrateConversation(
    conversationId: string,
    _options: { restoreHydrationRecovery?: boolean } = {}
  ): Promise<void> {
    const active = this.activeConversations.get(conversationId);
    this.activeConversations.delete(conversationId);
    if (!active) return;
    await active.adapter.dispose(active.session);
  }

  async abortHydratedConversation(conversationId: string): Promise<void> {
    await this.dehydrateConversation(conversationId, { restoreHydrationRecovery: false });
  }

  async cancelPendingPermissionRequestsForConversation(conversationId: string): Promise<void> {
    const active = this.activeConversations.get(conversationId);
    if (!active) return;
    await this.cancelPendingPermissionRequests(active.conversation);
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
    const active = await this.requireActive(projectId, taskId, conversationId);
    const text = input.text.trim();
    if (!text) throw new Error('Message text is required');
    if (active.awaitingInput) throw new Error('Agent is awaiting input');
    if (active.awaitingResponse) throw new Error('Agent is still responding');

    active.awaitingResponse = true;
    active.awaitingInput = false;
    this.emitStatus(active.conversation, 'working');

    let item: ConversationMessageTimelineItem | undefined;
    try {
      if (active.adapter.tryHandleOutOfBandCommand) {
        const handled = await active.adapter.tryHandleOutOfBandCommand(active.session, {
          ...input,
          text,
        });
        if (handled) {
          active.awaitingResponse = false;
          active.awaitingInput = false;
          this.emitStatus(active.conversation, 'completed');
          return {};
        }
      }

      item = await chatTimelineStore.appendUserMessage(
        active.conversation,
        { ...input, text },
        { emit: false }
      );
      await active.adapter.sendMessage(active.session, { ...input, text });
      await chatTimelineStore.markUserMessageDelivered(active.conversation, item);
      await chatTimelineStore.emitItem(active.conversation, item);
      this.emitInputSubmitted(active.conversation);
      return { item };
    } catch (error) {
      active.awaitingResponse = false;
      active.awaitingInput = false;
      if (item) {
        await this.deleteSilentItem(active.conversation, item.id, 'app-server send failed');
      }
      await chatTimelineStore
        .append(active.conversation, {
          kind: 'error',
          payload: { message: error instanceof Error ? error.message : String(error) },
        })
        .catch((appendError) => {
          log.warn('ChatConversationRuntime: failed to append send error', {
            conversationId,
            error: String(appendError),
          });
        });
      this.emitStatus(active.conversation, 'error');
      throw error;
    }
  }

  async cancelTurn(projectId: string, taskId: string, conversationId: string): Promise<void> {
    const active = await this.requireActive(projectId, taskId, conversationId);
    try {
      await active.adapter.cancel(active.session);
      active.awaitingInput = false;
      active.awaitingResponse = false;
      await this.cancelPendingPermissionRequests(active.conversation);
      await chatTimelineStore.append(active.conversation, {
        kind: 'reasoning',
        payload: { text: 'Turn cancelled.' },
      });
      this.emitStatus(active.conversation, 'idle');
    } catch (error) {
      const clearRuntimeState = isPreTurnStartCancelError(error);
      if (clearRuntimeState) {
        active.awaitingInput = false;
        active.awaitingResponse = false;
      }
      await chatTimelineStore
        .append(active.conversation, {
          kind: 'error',
          payload: { message: 'Failed to interrupt Codex app-server turn' },
        })
        .catch((appendError) => {
          log.warn('ChatConversationRuntime: failed to append cancellation error', {
            conversationId,
            error: String(appendError),
          });
        });
      this.emitStatus(
        active.conversation,
        clearRuntimeState ? 'error' : active.awaitingInput ? 'awaiting-input' : 'working'
      );
      throw error;
    }
  }

  async respondToPermission(
    projectId: string,
    taskId: string,
    conversationId: string,
    response: ConversationPermissionResponse
  ): Promise<void> {
    const active = await this.requireActive(projectId, taskId, conversationId);
    if (!active.awaitingInput) throw new Error('Agent is not awaiting permission input');
    if (!active.adapter.respondToPermission) {
      throw new Error('Permission responses are not supported by this chat provider');
    }

    const request = await chatTimelineStore.getPendingPermissionRequest(
      active.conversation,
      response
    );
    await chatTimelineStore.resolvePermissionRequest(active.conversation, response);
    active.awaitingInput = false;
    active.awaitingResponse = true;
    this.emitStatus(active.conversation, 'working');
    try {
      await active.adapter.respondToPermission(active.session, request, response);
    } catch (error) {
      active.awaitingInput = true;
      active.awaitingResponse = false;
      await chatTimelineStore
        .restorePendingPermissionRequest(active.conversation, request)
        .catch((restoreError) => {
          log.warn('ChatConversationRuntime: failed to restore permission request', {
            conversationId,
            error: String(restoreError),
            requestId: request.requestId,
          });
        });
      this.emitStatus(active.conversation, 'awaiting-input');
      throw error;
    }
  }

  async listCommands(
    projectId: string,
    taskId: string,
    conversationId: string
  ): Promise<AgentSlashCommand[]> {
    const active = await this.requireActive(projectId, taskId, conversationId);
    return active.adapter.listCommands?.(active.session) ?? [];
  }

  async executeSlashCommand(
    projectId: string,
    taskId: string,
    conversationId: string,
    command: AgentSlashCommandInput
  ): Promise<void> {
    const active = await this.requireActive(projectId, taskId, conversationId);
    if (active.awaitingInput) throw new Error('Agent is awaiting input');
    if (active.awaitingResponse) throw new Error('Agent is still responding');
    if (!active.adapter.executeSlashCommand) {
      throw new Error('Slash commands are not supported by this chat provider');
    }
    active.awaitingResponse = true;
    active.awaitingInput = false;
    this.emitStatus(active.conversation, 'working');
    try {
      await active.adapter.executeSlashCommand(active.session, command);
      active.awaitingResponse = false;
      active.awaitingInput = false;
      this.emitStatus(active.conversation, 'completed');
    } catch (error) {
      active.awaitingResponse = false;
      active.awaitingInput = false;
      await chatTimelineStore
        .append(active.conversation, {
          kind: 'error',
          payload: { message: error instanceof Error ? error.message : String(error) },
        })
        .catch((appendError) => {
          log.warn('ChatConversationRuntime: failed to append command error', {
            conversationId,
            error: String(appendError),
          });
        });
      this.emitStatus(active.conversation, 'error');
      throw error;
    }
  }

  async dehydrateTask(taskId: string): Promise<void> {
    const ids = Array.from(this.activeConversations)
      .filter(([, active]) => active.conversation.taskId === taskId)
      .map(([conversationId]) => conversationId);
    for (const conversationId of ids) {
      await this.dehydrateConversation(conversationId);
    }
  }

  suppressBackendExitForTaskDuringStop(_taskId: string): () => void {
    return () => {};
  }

  suppressBackendExitDuringStop(_conversationId: string): () => void {
    return () => {};
  }

  private async activateConversation(
    conversation: Conversation,
    options: { resume: boolean }
  ): Promise<void> {
    await chatTimelineStore.recoverPendingUserMessages(conversation);
    await this.cancelPendingPermissionRequests(conversation);

    const adapter = getChatProviderAdapter(conversation.providerId);
    const task = resolveTask(conversation.projectId, conversation.taskId);
    if (!task) throw new Error('Task not found');
    if (task.workspaceKind === 'ssh') {
      throw new Error('Codex chat runtime is only supported for local workspaces');
    }

    const pendingEvents: ChatProviderRuntimeEvent[] = [];
    let activeReady = false;
    const sessionConfig = {
      conversation,
      cwd: task.taskPath ?? process.cwd(),
      env: task.taskEnvVars,
      onEvent: (event: ChatProviderRuntimeEvent) => {
        if (!activeReady) {
          pendingEvents.push(event);
          return;
        }
        return this.recordProviderEvent(conversation.id, event);
      },
    };
    const session = options.resume
      ? await adapter.resumeSession(sessionConfig)
      : await adapter.createSession(sessionConfig);

    this.activeConversations.set(conversation.id, {
      adapter,
      awaitingInput: false,
      awaitingResponse: false,
      conversation: {
        ...conversation,
        providerSessionId: session.providerSessionId ?? conversation.providerSessionId,
      },
      session,
    });
    activeReady = true;
    if (session.providerSessionId) {
      await this.recordProviderEvent(conversation.id, {
        type: 'provider-session',
        providerSessionId: session.providerSessionId,
      });
    }
    for (const event of pendingEvents) {
      await this.recordProviderEvent(conversation.id, event);
    }
  }

  private async recordProviderEvent(
    conversationId: string,
    event: ChatProviderRuntimeEvent
  ): Promise<void> {
    const active = this.activeConversations.get(conversationId);
    if (!active) return;

    if (event.type === 'provider-session') {
      active.conversation = {
        ...active.conversation,
        providerSessionId: event.providerSessionId,
      };
      active.session.providerSessionId = event.providerSessionId;
      const updated = await setProviderSessionId(conversationId, event.providerSessionId);
      if (updated) {
        events.emit(conversationChangedChannel, {
          conversationId,
          projectId: active.conversation.projectId,
          taskId: active.conversation.taskId,
          changes: { providerSessionId: event.providerSessionId },
        });
      }
      return;
    }

    if (event.type === 'timeline') {
      await chatTimelineStore.append(active.conversation, event.item, {
        upsert: event.upsert,
      });
      return;
    }

    if (event.status === 'awaiting-input') {
      active.awaitingInput = true;
      active.awaitingResponse = false;
    } else if (event.status === 'working') {
      active.awaitingInput = false;
      active.awaitingResponse = true;
    } else if (
      event.status === 'completed' ||
      event.status === 'error' ||
      event.status === 'idle'
    ) {
      active.awaitingInput = false;
      active.awaitingResponse = false;
      await this.cancelPendingPermissionRequests(active.conversation);
    }
    this.emitStatus(active.conversation, event.status);
  }

  private async cancelPendingPermissionRequests(conversation: Conversation): Promise<void> {
    await chatTimelineStore.cancelPendingPermissionRequests(conversation).catch((error) => {
      log.warn('ChatConversationRuntime: failed to cancel pending permission requests', {
        conversationId: conversation.id,
        error: String(error),
      });
    });
  }

  private async deleteSilentItem(
    conversation: Conversation,
    itemId: string,
    reason: string
  ): Promise<void> {
    await chatTimelineStore.deleteItem(conversation, itemId).catch((error) => {
      log.warn('ChatConversationRuntime: failed to delete silent user message', {
        conversationId: conversation.id,
        error: String(error),
        itemId,
        reason,
      });
    });
  }

  private emitInputSubmitted(conversation: Conversation): void {
    conversationEvents._emit('conversation:input-submitted', {
      projectId: conversation.projectId,
      taskId: conversation.taskId,
      conversationId: conversation.id,
      providerId: conversation.providerId,
    });
  }

  private emitStatus(conversation: Conversation, status: ConversationStatus): void {
    events.emit(conversationStatusEventChannel, {
      projectId: conversation.projectId,
      taskId: conversation.taskId,
      conversationId: conversation.id,
      status,
    });
  }

  private async requireActive(
    projectId: string,
    taskId: string,
    conversationId: string
  ): Promise<ActiveChatConversation> {
    await chatTimelineStore.requireChatConversation(projectId, taskId, conversationId);
    const active = this.activeConversations.get(conversationId);
    if (
      !active ||
      active.conversation.projectId !== projectId ||
      active.conversation.taskId !== taskId
    ) {
      throw new Error('Conversation chat runtime is not active');
    }
    return active;
  }
}

export const chatConversationRuntime = new ChatConversationRuntime();

function isPreTurnStartCancelError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes('Cannot interrupt Codex turn before app-server reports turn start')
  );
}
