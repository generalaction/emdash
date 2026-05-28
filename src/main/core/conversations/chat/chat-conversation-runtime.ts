import { agentSessionEvents } from '@main/core/conversations/agent-session-events';
import { conversationEvents } from '@main/core/conversations/conversation-events';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import {
  type ConversationPermissionResponse,
  type ConversationStatus,
  type SendConversationMessageInput,
  type SendConversationMessageResult,
} from '@shared/conversation-timeline';
import type { Conversation } from '@shared/conversations';
import type { AgentEvent, AgentSessionExited } from '@shared/events/agentEvents';
import { conversationStatusEventChannel } from '@shared/events/conversationEvents';
import { resolveTask } from '../../projects/utils';
import { chatTimelineStore } from './chat-timeline-store';
import { getChatProviderAdapter } from './provider-adapters';
import type { ChatProviderAdapter, ChatProviderBackend } from './types';

type PendingTurn = {
  backendExit?: AgentSessionExited;
  backendStarted: boolean;
  bufferedEvents: AgentEvent[];
  cancelled: boolean;
  deliveryStarted: boolean;
  id: number;
};

type ActiveChatConversation = {
  conversation: Conversation;
  adapter: ChatProviderAdapter;
  awaitingInput?: boolean;
  awaitingResponse?: boolean;
  backendExitVersion: number;
  backendStopping?: boolean;
  cancelled?: boolean;
  cancellationBackendExit?: AgentSessionExited;
  cancellationBufferedEvents?: AgentEvent[];
  cancellationInFlight?: boolean;
  cancellationPromise?: Promise<boolean>;
  resolveCancellation?: (cancelled: boolean) => void;
  inputReady?: boolean;
  lastAssistantMessage?: string;
  nextTurnId: number;
  pendingTurn?: PendingTurn;
  suppressProviderEventsUntilNextSend?: boolean;
};

export class ChatConversationRuntime {
  private readonly activeConversations = new Map<string, ActiveChatConversation>();

  constructor(options: { subscribeToSessionEvents?: boolean } = {}) {
    if (options.subscribeToSessionEvents) {
      agentSessionEvents.on('agent:session-exited', (event) => this.recordBackendExit(event));
    }
  }

  async startConversation(conversation: Conversation, initialPrompt?: string): Promise<void> {
    await this.activateConversation(conversation);
    const text = initialPrompt?.trim();
    if (!text) return;

    try {
      await this.sendMessage(conversation.projectId, conversation.taskId, conversation.id, {
        text,
      });
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
    const adapter = this.adapterFor(conversation);
    const text = input.text.trim();
    if (!text) throw new Error('Message text is required');
    const active = this.activeConversations.get(conversationId);
    if (!active) throw new Error('Conversation chat runtime is not active');
    if (active.awaitingInput) throw new Error('Agent is awaiting input');
    if (active.awaitingResponse) throw new Error('Agent is still responding');
    if (active.pendingTurn) throw new Error('A message is already being sent');

    const turnId = ++active.nextTurnId;
    active.awaitingResponse = true;
    active.awaitingInput = false;
    active.cancelled = false;
    active.cancellationBufferedEvents = undefined;
    active.cancellationInFlight = false;
    active.lastAssistantMessage = undefined;
    active.suppressProviderEventsUntilNextSend = false;
    active.pendingTurn = {
      backendStarted: false,
      bufferedEvents: [],
      cancelled: false,
      deliveryStarted: false,
      id: turnId,
    };
    this.emitStatus(conversation, 'working');

    try {
      await this.ensureBackendReadyForInput(active, backend, turnId);
    } catch (error) {
      if (active.pendingTurn?.id === turnId) {
        active.pendingTurn = undefined;
      }
      active.awaitingResponse = false;
      active.suppressProviderEventsUntilNextSend = true;
      this.emitStatus(conversation, 'error');
      throw error;
    }
    const backendExitVersionBeforeSend = active.backendExitVersion;

    if (await this.isTurnCancelled(active, turnId)) {
      if (active.pendingTurn?.id === turnId) {
        active.pendingTurn = undefined;
      }
      active.awaitingResponse = false;
      this.emitStatus(conversation, 'idle');
      throw new Error('Message send was cancelled');
    }

    let item: Awaited<ReturnType<typeof chatTimelineStore.appendUserMessage>>;
    try {
      item = await chatTimelineStore.appendUserMessage(
        conversation,
        { ...input, text },
        {
          emit: false,
        }
      );
    } catch (error) {
      if (active.pendingTurn?.id === turnId) {
        active.pendingTurn = undefined;
      }
      active.awaitingResponse = false;
      active.suppressProviderEventsUntilNextSend = true;
      this.emitStatus(conversation, 'error');
      throw error;
    }

    if (active.pendingTurn?.id !== turnId) {
      await this.deleteSilentItem(conversation, item.id, 'turn superseded before backend send');
      active.awaitingResponse = false;
      throw new Error('Message send was cancelled');
    }

    if (await this.isTurnCancelled(active, turnId)) {
      if (active.pendingTurn?.id === turnId) {
        active.pendingTurn = undefined;
      }
      await this.deleteSilentItem(conversation, item.id, 'turn cancelled before backend send');
      active.awaitingResponse = false;
      this.emitStatus(conversation, 'idle');
      throw new Error('Message send was cancelled');
    }

    if (
      await this.abortIfBackendExitedBeforeSend(
        active,
        turnId,
        conversation,
        item,
        backendExitVersionBeforeSend
      )
    ) {
      throw new Error('Agent backend exited before message could be sent');
    }

    try {
      active.pendingTurn.deliveryStarted = true;
      await chatTimelineStore.markUserMessageDeliveryStarted(conversation, item);
    } catch (error) {
      if (active.pendingTurn?.id === turnId) {
        active.pendingTurn = undefined;
      }
      active.awaitingResponse = false;
      active.suppressProviderEventsUntilNextSend = true;
      await this.deleteSilentItem(conversation, item.id, 'delivery state update failed');
      await chatTimelineStore
        .append(conversation, {
          kind: 'error',
          payload: { message: 'Failed to send message to the agent backend' },
        })
        .catch((appendError) => {
          log.warn('ChatConversationRuntime: failed to append backend send error marker', {
            conversationId,
            error: String(appendError),
          });
        });
      this.emitStatus(conversation, 'error');
      throw error;
    }

    if (
      await this.abortIfBackendExitedBeforeSend(
        active,
        turnId,
        conversation,
        item,
        backendExitVersionBeforeSend
      )
    ) {
      throw new Error('Agent backend exited before message could be sent');
    }

    if (active.pendingTurn?.id !== turnId) {
      await this.deleteSilentItem(conversation, item.id, 'turn superseded before backend send');
      active.awaitingResponse = false;
      throw new Error('Message send was cancelled');
    }

    if (await this.isTurnCancelled(active, turnId)) {
      active.pendingTurn = undefined;
      await this.deleteSilentItem(conversation, item.id, 'turn cancelled before backend send');
      active.awaitingResponse = false;
      this.emitStatus(conversation, 'idle');
      throw new Error('Message send was cancelled');
    }

    active.pendingTurn.backendStarted = true;
    try {
      await backend.sendInput(conversation.id, adapter.buildMessageInput(conversation, text));
      if (await this.isTurnCancelled(active, turnId)) {
        throw new Error('Message send was cancelled');
      }
      await this.markDeliveredUserMessage(conversation, item);
    } catch (error) {
      const deliveryCancelled =
        active.cancelled ||
        active.cancellationInFlight ||
        active.pendingTurn?.cancelled === true ||
        (error instanceof Error && error.message === 'Message send was cancelled');
      if (active.pendingTurn?.id === turnId) {
        active.pendingTurn = undefined;
      }
      active.awaitingResponse = false;
      active.inputReady = false;
      await this.deleteSilentItem(conversation, item.id, 'backend delivery failed');
      if (deliveryCancelled) {
        if (!active.cancellationInFlight) {
          this.emitStatus(conversation, 'idle');
        }
        throw new Error('Message send was cancelled');
      }
      await chatTimelineStore
        .append(conversation, {
          kind: 'error',
          payload: { message: 'Failed to send message to the agent backend' },
        })
        .catch((appendError) => {
          log.warn('ChatConversationRuntime: failed to append backend send error marker', {
            conversationId,
            error: String(appendError),
          });
        });
      this.emitStatus(conversation, 'error');
      throw error;
    }

    if (active.pendingTurn?.id !== turnId) {
      await this.deleteSilentItem(conversation, item.id, 'turn superseded after backend send');
      active.awaitingResponse = false;
      throw new Error('Message send was cancelled');
    }

    if (await this.isTurnCancelled(active, turnId)) {
      active.pendingTurn = undefined;
      await this.deleteSilentItem(conversation, item.id, 'turn cancelled after backend send');
      active.awaitingResponse = false;
      this.emitStatus(conversation, 'idle');
      throw new Error('Message send was cancelled');
    }

    await this.revealSentUserMessage(conversation, item);
    this.emitInputSubmitted(conversation);
    const pendingBackendExit = await this.flushPendingTurn(active, turnId);
    if (pendingBackendExit) {
      await this.recordBackendExit(pendingBackendExit);
    }
    return { item };
  }

  async cancelTurn(projectId: string, taskId: string, conversationId: string): Promise<void> {
    const conversation = await this.requireActiveConversation(projectId, taskId, conversationId);
    const active = this.activeConversations.get(conversationId);
    const wasCancelled = active?.cancelled;
    const wasAwaitingInput = active?.awaitingInput;
    const wasAwaitingResponse = active?.awaitingResponse;
    const pendingTurn = active?.pendingTurn;
    const pendingTurnWasCancelled = pendingTurn?.cancelled;
    if (active?.cancelled && !active.awaitingResponse && !active.pendingTurn) {
      this.emitStatus(conversation, 'idle');
      return;
    }

    if (
      active?.pendingTurn &&
      !active.pendingTurn.backendStarted &&
      !active.pendingTurn.deliveryStarted
    ) {
      active.pendingTurn.cancelled = true;
      active.cancelled = true;
      active.awaitingInput = false;
      active.awaitingResponse = false;
      active.inputReady = false;
      active.pendingTurn = undefined;
      await this.appendCancellationMarker(conversation);
      this.emitStatus(conversation, 'idle');
      return;
    }

    const hadPendingTurn = active?.pendingTurn !== undefined;
    if (active) {
      if (active.cancellationInFlight) {
        await active.cancellationPromise;
        return;
      }
      active.cancellationBufferedEvents = [];
      active.cancellationInFlight = true;
      active.inputReady = false;
      active.cancellationPromise = new Promise((resolve) => {
        active.resolveCancellation = resolve;
      });
    }
    try {
      await this.adapterFor(conversation).cancel(
        conversation,
        this.getBackendProvider(conversation)
      );
    } catch (error) {
      let processedBackendExit = false;
      if (active) {
        active.cancelled = wasCancelled;
        active.awaitingInput = wasAwaitingInput;
        active.awaitingResponse = wasAwaitingResponse;
        active.cancellationInFlight = false;
        active.resolveCancellation?.(false);
        active.cancellationPromise = undefined;
        active.resolveCancellation = undefined;
        const backendExit = active.cancellationBackendExit;
        active.cancellationBackendExit = undefined;
        if (pendingTurn && active.pendingTurn?.id === pendingTurn.id) {
          active.pendingTurn.cancelled = pendingTurnWasCancelled ?? false;
        }
        await this.flushCancellationBufferedEvents(active);
        if (backendExit) {
          await this.recordBackendExit(backendExit);
          processedBackendExit = true;
        }
      }
      await chatTimelineStore
        .append(conversation, {
          kind: 'error',
          payload: { message: 'Failed to interrupt agent backend' },
        })
        .catch((appendError) => {
          log.warn('ChatConversationRuntime: failed to append cancellation error marker', {
            conversationId,
            error: String(appendError),
          });
        });
      if (processedBackendExit) {
        throw error;
      }
      if (active?.awaitingInput) {
        this.emitStatus(conversation, 'awaiting-input');
      } else if (active?.awaitingResponse || active?.pendingTurn) {
        this.emitStatus(conversation, 'working');
      } else {
        this.emitStatus(conversation, 'error');
      }
      throw error;
    }

    let shouldEmitIdle = !hadPendingTurn;
    if (active) {
      active.cancellationBufferedEvents = undefined;
      active.cancellationBackendExit = undefined;
      active.cancellationInFlight = false;
      active.resolveCancellation?.(true);
      active.cancellationPromise = undefined;
      active.resolveCancellation = undefined;
      active.cancelled = true;
      if (active.pendingTurn) {
        active.pendingTurn.cancelled = true;
      }
      shouldEmitIdle = shouldEmitIdle || active.pendingTurn === undefined;
      active.awaitingInput = false;
      active.awaitingResponse = false;
      active.inputReady = false;
    }
    await this.appendCancellationMarker(conversation);
    if (shouldEmitIdle) {
      this.emitStatus(conversation, 'idle');
    }
  }

  private async appendCancellationMarker(conversation: Conversation): Promise<void> {
    await chatTimelineStore
      .append(conversation, {
        kind: 'reasoning',
        payload: { text: 'Turn cancelled.' },
      })
      .catch((error) => {
        log.warn('ChatConversationRuntime: failed to append cancellation marker', {
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
    try {
      await chatTimelineStore.deleteItem(conversation, itemId);
    } catch (error) {
      log.warn('ChatConversationRuntime: failed to delete silent user message', {
        conversationId: conversation.id,
        error: String(error),
        itemId,
        reason,
      });
    }
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

    if (active.cancelled) return;
    if (active.suppressProviderEventsUntilNextSend) return;
    if (active.cancellationInFlight) {
      active.cancellationBufferedEvents?.push(event);
      return;
    }
    if (
      !active.awaitingResponse &&
      !active.pendingTurn &&
      event.type === 'notification' &&
      !event.payload.lastAssistantMessage?.trim() &&
      (event.payload.notificationType === 'idle_prompt' ||
        event.payload.notificationType === 'permission_prompt' ||
        event.payload.notificationType === 'elicitation_dialog')
    ) {
      return;
    }

    if (active.pendingTurn) {
      if (!active.pendingTurn.backendStarted) return;
      active.pendingTurn.bufferedEvents.push(event);
      return;
    }

    await this.recordMappedAgentEvent(active, event);
  }

  async recordBackendExit(event: AgentSessionExited): Promise<void> {
    const active = this.activeConversations.get(event.conversationId);
    if (
      !active ||
      active.conversation.projectId !== event.projectId ||
      active.conversation.taskId !== event.taskId
    ) {
      return;
    }

    if (active.backendStopping) {
      active.backendExitVersion += 1;
      active.inputReady = false;
      return;
    }

    active.backendExitVersion += 1;
    active.inputReady = false;
    if (!active.awaitingResponse && !active.pendingTurn && !active.awaitingInput) {
      return;
    }

    if (active.pendingTurn) {
      active.pendingTurn.backendExit = event;
      return;
    }

    if (active.cancellationInFlight) {
      active.cancellationBackendExit = event;
      return;
    }

    if (active.cancelled) {
      active.awaitingInput = false;
      active.awaitingResponse = false;
      this.emitStatus(active.conversation, 'idle');
      return;
    }

    active.awaitingInput = false;
    active.awaitingResponse = false;
    active.pendingTurn = undefined;
    const status = event.exitCode === 0 ? 'completed' : 'error';
    if (status === 'error') {
      await chatTimelineStore
        .append(active.conversation, {
          kind: 'error',
          payload: { message: 'Agent backend exited before completing the turn' },
        })
        .catch((error) => {
          log.warn('ChatConversationRuntime: failed to append backend exit error marker', {
            conversationId: active.conversation.id,
            error: String(error),
          });
        });
    }
    this.emitStatus(active.conversation, status);
  }

  private async revealSentUserMessage(
    conversation: Conversation,
    item: Awaited<ReturnType<typeof chatTimelineStore.appendUserMessage>>
  ): Promise<void> {
    try {
      await chatTimelineStore.emitItem(conversation, item);
    } catch (error) {
      log.warn('ChatConversationRuntime: failed to reveal delivered user message', {
        conversationId: conversation.id,
        error: String(error),
        itemId: item.id,
      });
      await chatTimelineStore
        .append(conversation, {
          kind: 'error',
          payload: { message: 'Message was sent, but Emdash could not update the chat timeline.' },
        })
        .catch((appendError) => {
          log.warn('ChatConversationRuntime: failed to append user message reveal error marker', {
            conversationId: conversation.id,
            error: String(appendError),
          });
        });
    }
  }

  private async abortIfBackendExitedBeforeSend(
    active: ActiveChatConversation,
    turnId: number,
    conversation: Conversation,
    item: Awaited<ReturnType<typeof chatTimelineStore.appendUserMessage>>,
    backendExitVersionBeforeSend: number
  ): Promise<boolean> {
    if (active.pendingTurn?.id !== turnId) return false;
    if (
      active.backendExitVersion === backendExitVersionBeforeSend &&
      active.pendingTurn.backendExit === undefined
    ) {
      return false;
    }

    active.pendingTurn = undefined;
    active.awaitingResponse = false;
    active.inputReady = false;
    active.suppressProviderEventsUntilNextSend = true;
    await this.deleteSilentItem(conversation, item.id, 'backend exited before backend send');
    await chatTimelineStore
      .append(conversation, {
        kind: 'error',
        payload: { message: 'Agent backend exited before message could be sent' },
      })
      .catch((appendError) => {
        log.warn('ChatConversationRuntime: failed to append pre-send backend exit marker', {
          conversationId: conversation.id,
          error: String(appendError),
        });
      });
    this.emitStatus(conversation, 'error');
    return true;
  }

  private async markDeliveredUserMessage(
    conversation: Conversation,
    item: Awaited<ReturnType<typeof chatTimelineStore.appendUserMessage>>
  ): Promise<void> {
    try {
      await chatTimelineStore.markUserMessageDelivered(conversation, item);
    } catch (error) {
      log.warn('ChatConversationRuntime: failed to mark user message delivered', {
        conversationId: conversation.id,
        error: String(error),
        itemId: item.id,
      });
    }
  }

  private async flushPendingTurn(
    active: ActiveChatConversation,
    turnId: number
  ): Promise<AgentSessionExited | undefined> {
    let backendExit: AgentSessionExited | undefined;
    while (active.pendingTurn?.id === turnId && active.pendingTurn.bufferedEvents.length > 0) {
      const eventsToFlush = active.pendingTurn.bufferedEvents.splice(0);
      for (const event of eventsToFlush) {
        if (active.cancelled) break;
        await this.recordMappedAgentEvent(active, event);
      }
    }
    if (active.pendingTurn?.id === turnId) {
      backendExit = active.pendingTurn.backendExit;
      active.pendingTurn = undefined;
    }
    return backendExit;
  }

  private async flushCancellationBufferedEvents(active: ActiveChatConversation): Promise<void> {
    const bufferedEvents = active.cancellationBufferedEvents?.splice(0) ?? [];
    active.cancellationBufferedEvents = undefined;
    for (const event of bufferedEvents) {
      if (active.pendingTurn) {
        if (active.pendingTurn.backendStarted) {
          active.pendingTurn.bufferedEvents.push(event);
        }
        continue;
      }
      await this.recordMappedAgentEvent(active, event);
    }
  }

  private async isTurnCancelled(active: ActiveChatConversation, turnId: number): Promise<boolean> {
    if (active.pendingTurn?.id !== turnId) return true;
    if (active.cancelled || active.pendingTurn.cancelled) return true;
    if (!active.cancellationInFlight) return false;

    const cancellationPromise = active.cancellationPromise;
    if (cancellationPromise) {
      await cancellationPromise;
    }
    const latest = this.activeConversations.get(active.conversation.id);
    if (latest?.pendingTurn?.id !== turnId) return true;
    return latest.cancelled === true || latest.pendingTurn.cancelled === true;
  }

  private async ensureBackendReadyForInput(
    active: ActiveChatConversation,
    backend: ChatProviderBackend,
    turnId: number
  ): Promise<void> {
    if (active.inputReady) return;
    const backendExitVersion = active.backendExitVersion;
    await backend.waitUntilReadyForInput?.(active.conversation);
    if (active.backendExitVersion !== backendExitVersion) {
      if (active.pendingTurn?.id !== turnId || active.cancelled) return;
      throw new Error('Agent backend exited before input was ready');
    }
    if (active.pendingTurn?.id !== turnId || active.pendingTurn.cancelled || active.cancelled) {
      return;
    }
    active.inputReady = true;
  }

  private async recordMappedAgentEvent(
    active: ActiveChatConversation,
    event: AgentEvent
  ): Promise<void> {
    for (const mapped of active.adapter.mapAgentEvent(event)) {
      if (mapped.type === 'status') {
        if (
          !active.awaitingResponse &&
          (mapped.status === 'completed' || mapped.status === 'awaiting-input')
        ) {
          continue;
        }
        this.emitStatus(active.conversation, mapped.status);
        if (
          mapped.status === 'completed' ||
          mapped.status === 'error' ||
          mapped.status === 'awaiting-input'
        ) {
          active.awaitingResponse = false;
        }
        if (mapped.status === 'awaiting-input') {
          active.awaitingInput = true;
        } else if (mapped.status === 'completed' || mapped.status === 'error') {
          active.awaitingInput = false;
        }
        continue;
      }

      const assistantText =
        mapped.item.kind === 'assistant_message' ? mapped.item.payload.text.trim() : undefined;
      if (assistantText && assistantText === active.lastAssistantMessage) continue;

      try {
        await chatTimelineStore.append(active.conversation, mapped.item);
      } catch (error) {
        log.warn('ChatConversationRuntime: failed to append mapped timeline item', {
          conversationId: active.conversation.id,
          error: String(error),
          kind: mapped.item.kind,
        });
        continue;
      }
      if (assistantText) {
        active.lastAssistantMessage = assistantText;
      }
    }
  }

  dehydrateTask(taskId: string): void {
    for (const [conversationId, active] of this.activeConversations) {
      if (active.conversation.taskId === taskId) {
        this.activeConversations.delete(conversationId);
      }
    }
  }

  suppressBackendExitForTaskDuringStop(taskId: string): () => void {
    const releaseByConversation: Array<() => void> = [];
    for (const [conversationId, active] of this.activeConversations) {
      if (active.conversation.taskId === taskId) {
        releaseByConversation.push(this.suppressBackendExitDuringStop(conversationId));
      }
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const release of releaseByConversation) {
        release();
      }
    };
  }

  suppressBackendExitDuringStop(conversationId: string): () => void {
    const active = this.activeConversations.get(conversationId);
    if (!active) return () => {};

    active.backendStopping = true;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const latest = this.activeConversations.get(conversationId);
      if (latest) latest.backendStopping = false;
    };
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
    await chatTimelineStore.recoverPendingUserMessages(conversation);
    this.activeConversations.set(conversation.id, {
      conversation,
      adapter: getChatProviderAdapter(conversation.providerId),
      backendExitVersion: 0,
      inputReady: false,
      lastAssistantMessage: await chatTimelineStore.getLatestAssistantMessage(conversation.id),
      nextTurnId: 0,
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

  private adapterFor(conversation: Conversation): ChatProviderAdapter {
    return (
      this.activeConversations.get(conversation.id)?.adapter ??
      getChatProviderAdapter(conversation.providerId)
    );
  }

  private emitStatus(conversation: Conversation, status: ConversationStatus): void {
    events.emit(conversationStatusEventChannel, {
      projectId: conversation.projectId,
      taskId: conversation.taskId,
      conversationId: conversation.id,
      status,
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

export const chatConversationRuntime = new ChatConversationRuntime({
  subscribeToSessionEvents: true,
});
