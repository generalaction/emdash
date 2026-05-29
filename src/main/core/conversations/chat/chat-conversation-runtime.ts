import { agentSessionEvents } from '@main/core/conversations/agent-session-events';
import { conversationEvents } from '@main/core/conversations/conversation-events';
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
  userMessage?: ConversationMessageTimelineItem;
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
  cancellationError?: unknown;
  cancellationInFlight?: boolean;
  cancellationPromise?: Promise<boolean>;
  resolveCancellation?: (cancelled: boolean) => void;
  inputReady?: boolean;
  lastAssistantMessage?: string;
  nextTurnId: number;
  pendingTurn?: PendingTurn;
  permissionResponseRestoredDuringCancellation?: boolean;
  permissionResponseInFlight?: boolean;
  recoveringFromHydration?: boolean;
  recoveryCancelledPermissionIds?: string[];
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
      await this.dehydrateConversation(conversation.id);
      throw error;
    }
  }

  async hydrateConversation(conversation: Conversation): Promise<void> {
    const active = this.activeConversations.get(conversation.id);
    if (active) {
      active.conversation = conversation;
      return;
    }
    await this.activateConversation(conversation, { recoveringFromHydration: true });
  }

  async dehydrateConversation(
    conversationId: string,
    options: { restoreHydrationRecovery?: boolean } = {}
  ): Promise<void> {
    const active = this.activeConversations.get(conversationId);
    this.activeConversations.delete(conversationId);
    if (!active || options.restoreHydrationRecovery === false) return;
    await this.restoreHydrationPermissionRecovery(active);
  }

  async abortHydratedConversation(conversationId: string): Promise<void> {
    const active = this.activeConversations.get(conversationId);
    this.activeConversations.delete(conversationId);
    if (!active) return;
    await this.restoreHydrationPermissionRecovery(active);
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
    const conversation = await this.requireActiveConversation(projectId, taskId, conversationId);
    const backend = this.getBackendProvider(conversation);
    const adapter = this.adapterFor(conversation);
    const text = input.text.trim();
    if (!text) throw new Error('Message text is required');
    const active = this.activeConversations.get(conversationId);
    if (!active) throw new Error('Conversation chat runtime is not active');
    if (active.awaitingInput) throw new Error('Agent is awaiting input');
    if (active.awaitingResponse) throw new Error('Agent is still responding');
    if (active.permissionResponseInFlight) throw new Error('Agent is still responding');
    if (active.pendingTurn) throw new Error('A message is already being sent');

    const turnId = ++active.nextTurnId;
    active.awaitingResponse = true;
    active.awaitingInput = false;
    active.cancelled = false;
    active.cancellationBufferedEvents = undefined;
    active.cancellationInFlight = false;
    active.lastAssistantMessage = undefined;
    active.permissionResponseInFlight = false;
    this.clearHydrationRecovery(active);
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
      if (this.isClearedCancelledTurn(active, turnId)) {
        throw new Error('Message send was cancelled');
      }
      if (this.clearCurrentTurn(active, turnId)) {
        active.suppressProviderEventsUntilNextSend = true;
        this.emitStatus(conversation, 'error');
      }
      throw error;
    }
    const backendExitVersionBeforeSend = active.backendExitVersion;

    if (await this.isTurnCancelled(active, turnId)) {
      if (this.clearCurrentTurn(active, turnId)) {
        this.emitStatus(conversation, 'idle');
      }
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
      if (this.isClearedCancelledTurn(active, turnId)) {
        throw new Error('Message send was cancelled');
      }
      if (this.clearCurrentTurn(active, turnId)) {
        active.suppressProviderEventsUntilNextSend = true;
        this.emitStatus(conversation, 'error');
      }
      throw error;
    }

    if (active.pendingTurn?.id === turnId) {
      active.pendingTurn.userMessage = item;
    }

    if (active.pendingTurn?.id !== turnId) {
      await this.deleteSilentItem(conversation, item.id, 'turn superseded before backend send');
      this.clearCurrentTurn(active, turnId);
      throw new Error('Message send was cancelled');
    }

    if (await this.isTurnCancelled(active, turnId)) {
      const cleared = this.clearCurrentTurn(active, turnId);
      await this.markCancelledUserMessage(conversation, item);
      await this.deleteSilentItem(conversation, item.id, 'turn cancelled before backend send');
      if (cleared) {
        this.emitStatus(conversation, 'idle');
      }
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
      const cancelled = this.isClearedCancelledTurn(active, turnId);
      const cleared = cancelled ? false : this.clearCurrentTurn(active, turnId);
      if (cleared) {
        active.suppressProviderEventsUntilNextSend = true;
      }
      await this.deleteSilentItem(conversation, item.id, 'delivery state update failed');
      if (cancelled) {
        throw new Error('Message send was cancelled');
      }
      if (cleared) {
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
      }
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
      this.clearCurrentTurn(active, turnId);
      throw new Error('Message send was cancelled');
    }

    if (await this.isTurnCancelled(active, turnId)) {
      const cleared = this.clearCurrentTurn(active, turnId);
      await this.markCancelledUserMessage(conversation, item);
      await this.deleteSilentItem(conversation, item.id, 'turn cancelled before backend send');
      if (cleared) {
        this.emitStatus(conversation, 'idle');
      }
      throw new Error('Message send was cancelled');
    }

    active.pendingTurn.backendStarted = true;
    let deliveryAccepted = false;
    try {
      await backend.sendInput(conversation.id, adapter.buildMessageInput(conversation, text));
      await this.markDeliveredUserMessage(conversation, item);
      deliveryAccepted = true;
      if (await this.isTurnCancelled(active, turnId)) {
        await this.revealSentUserMessage(conversation, item);
        this.emitInputSubmitted(conversation);
        throw new Error('Message send was cancelled');
      }
    } catch (error) {
      const deliveryCancelled =
        active.cancelled ||
        active.pendingTurn?.cancelled === true ||
        (error instanceof Error && error.message === 'Message send was cancelled');
      const cleared = this.clearCurrentTurn(active, turnId);
      active.inputReady = false;
      if (!deliveryAccepted) {
        await this.deleteSilentItem(conversation, item.id, 'backend delivery failed');
      }
      if (deliveryCancelled) {
        if (cleared && !active.cancellationInFlight) {
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
      this.clearCurrentTurn(active, turnId);
      await this.revealSentUserMessage(conversation, item);
      this.emitInputSubmitted(conversation);
      throw new Error('Message send was cancelled');
    }

    if (await this.isTurnCancelled(active, turnId)) {
      const cleared = this.clearCurrentTurn(active, turnId);
      await this.revealSentUserMessage(conversation, item);
      this.emitInputSubmitted(conversation);
      if (cleared) {
        this.emitStatus(conversation, 'idle');
      }
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
    const pendingTurn = active?.pendingTurn;
    const pendingTurnWasCancelled = pendingTurn?.cancelled;
    if (active?.cancelled && !active.awaitingResponse && !active.pendingTurn) {
      this.emitStatus(conversation, 'idle');
      return;
    }

    if (active?.pendingTurn && !active.pendingTurn.backendStarted) {
      const userMessage = active.pendingTurn.userMessage;
      active.pendingTurn.cancelled = true;
      active.cancelled = true;
      this.clearHydrationRecovery(active);
      active.awaitingInput = false;
      active.awaitingResponse = false;
      active.inputReady = false;
      active.pendingTurn = undefined;
      if (userMessage) {
        await this.markCancelledUserMessage(conversation, userMessage);
        await this.deleteSilentItem(
          conversation,
          userMessage.id,
          'turn cancelled before backend send'
        );
      }
      await this.cancelPendingPermissionRequests(conversation);
      await this.appendCancellationMarker(conversation);
      this.emitStatus(conversation, 'idle');
      return;
    }

    const hadPendingTurn = active?.pendingTurn !== undefined;
    if (active) {
      if (active.cancellationInFlight) {
        const cancelled = await active.cancellationPromise;
        if (!cancelled)
          throw active.cancellationError ?? new Error('Failed to interrupt agent backend');
        return;
      }
      active.cancellationBufferedEvents = [];
      active.cancellationError = undefined;
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
        const restoredPermissionDuringCancellation =
          active.permissionResponseRestoredDuringCancellation ?? false;
        active.cancelled = wasCancelled;
        active.awaitingInput = restoredPermissionDuringCancellation || wasAwaitingInput;
        active.permissionResponseRestoredDuringCancellation = undefined;
        active.cancellationError = error;
        active.cancellationInFlight = false;
        active.resolveCancellation?.(false);
        active.cancellationPromise = undefined;
        active.resolveCancellation = undefined;
        const backendExit = active.cancellationBackendExit;
        active.cancellationBackendExit = undefined;
        active.awaitingResponse = restoredPermissionDuringCancellation
          ? false
          : active.awaitingResponse;
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
      active.cancellationError = undefined;
      active.cancellationInFlight = false;
      active.resolveCancellation?.(true);
      active.cancellationPromise = undefined;
      active.resolveCancellation = undefined;
      active.cancelled = true;
      this.clearHydrationRecovery(active);
      if (active.pendingTurn) {
        active.pendingTurn.cancelled = true;
        if (active.pendingTurn.userMessage) {
          await this.markCancelledUserMessage(conversation, active.pendingTurn.userMessage);
        }
      }
      shouldEmitIdle = shouldEmitIdle || active.pendingTurn === undefined;
      active.awaitingInput = false;
      active.awaitingResponse = false;
      active.inputReady = false;
      active.permissionResponseInFlight = false;
      active.permissionResponseRestoredDuringCancellation = undefined;
    }
    await this.cancelPendingPermissionRequests(conversation);
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
    response: ConversationPermissionResponse
  ): Promise<void> {
    const conversation = await this.requireActiveConversation(projectId, taskId, conversationId);
    const active = this.activeConversations.get(conversationId);
    if (!active) throw new Error('Conversation chat runtime is not active');
    if (!active.awaitingInput) {
      throw new Error('Agent is not awaiting permission input');
    }
    if (active.cancellationInFlight) {
      throw new Error('Agent cancellation is in progress');
    }
    if (active.permissionResponseInFlight) {
      throw new Error('Agent is not awaiting permission input');
    }
    const respondToPermission = active.adapter.respondToPermission;
    if (!respondToPermission) {
      throw new Error('Permission responses are not supported by this chat provider');
    }

    active.permissionResponseInFlight = true;
    active.awaitingInput = false;
    let request: Awaited<ReturnType<typeof chatTimelineStore.getPendingPermissionRequest>>;
    const backendExitVersion = active.backendExitVersion;
    try {
      request = await chatTimelineStore.getPendingPermissionRequest(conversation, response);
      await chatTimelineStore.resolvePermissionRequest(conversation, response);
    } catch (error) {
      active.permissionResponseInFlight = false;
      if (
        this.activeConversations.get(conversationId) === active &&
        active.cancellationInFlight &&
        !active.cancelled &&
        active.backendExitVersion === backendExitVersion
      ) {
        active.awaitingInput = true;
        active.permissionResponseRestoredDuringCancellation = true;
      }
      if (active.backendExitVersion !== backendExitVersion) {
        throw new Error('Agent backend exited before permission response was sent');
      }
      if (
        this.activeConversations.get(conversationId) === active &&
        !active.cancelled &&
        !active.cancellationInFlight
      ) {
        active.awaitingInput = true;
      }
      throw error;
    }
    if (this.activeConversations.get(conversationId) !== active) {
      active.permissionResponseInFlight = false;
      await this.revertPermissionResolutionBeforeBackendSend(conversation, active, request, {
        cancel: false,
      });
      throw new Error('Conversation chat runtime is not active');
    }
    if (active.backendExitVersion !== backendExitVersion) {
      active.permissionResponseInFlight = false;
      await this.revertPermissionResolutionBeforeBackendSend(conversation, active, request, {
        cancel: true,
      });
      throw new Error('Agent backend exited before permission response was sent');
    }
    if (active.cancellationInFlight) {
      active.permissionResponseInFlight = false;
      await this.revertPermissionResolutionBeforeBackendSend(conversation, active, request, {
        cancel: false,
        duringCancellation: true,
      });
      throw new Error('Agent cancellation is in progress');
    }
    if (active.cancelled) {
      active.permissionResponseInFlight = false;
      await this.revertPermissionResolutionBeforeBackendSend(conversation, active, request, {
        cancel: true,
      });
      throw new Error('Agent cancellation is in progress');
    }
    active.awaitingResponse = true;
    active.permissionResponseInFlight = false;
    active.cancelled = false;
    active.suppressProviderEventsUntilNextSend = false;
    this.emitStatus(conversation, 'working');
    try {
      await respondToPermission.call(
        active.adapter,
        conversation,
        this.getBackendProvider(conversation),
        request,
        response
      );
    } catch (error) {
      const cancellationWriteFailure =
        this.activeConversations.get(conversationId) === active &&
        active.backendExitVersion === backendExitVersion &&
        active.cancellationInFlight &&
        !active.cancelled;
      if (cancellationWriteFailure) {
        active.awaitingResponse = false;
        active.inputReady = false;
        await this.revertPermissionResolutionBeforeBackendSend(conversation, active, request, {
          cancel: false,
          duringCancellation: true,
        });
        throw error;
      }
      const staleFailure =
        this.activeConversations.get(conversationId) !== active ||
        active.backendExitVersion !== backendExitVersion ||
        active.cancelled ||
        active.cancellationInFlight ||
        !active.awaitingResponse;
      if (staleFailure) {
        throw error;
      }
      active.awaitingResponse = false;
      active.inputReady = false;
      try {
        await chatTimelineStore.restorePendingPermissionRequest(conversation, request);
        active.awaitingInput = true;
      } catch (restoreError) {
        log.warn(
          'ChatConversationRuntime: failed to restore permission request after backend write failure',
          {
            conversationId,
            error: String(restoreError),
            requestId: request.requestId,
          }
        );
      }
      await chatTimelineStore
        .append(conversation, {
          kind: 'error',
          payload: { message: 'Failed to send permission response to the agent backend' },
        })
        .catch((appendError) => {
          log.warn('ChatConversationRuntime: failed to append permission response error marker', {
            conversationId,
            error: String(appendError),
          });
        });
      this.emitStatus(conversation, active.awaitingInput ? 'awaiting-input' : 'error');
      throw error;
    }
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
        (event.payload.notificationType === 'permission_prompt' &&
          !active.recoveringFromHydration) ||
        (event.payload.notificationType === 'elicitation_dialog' &&
          !active.recoveringFromHydration))
    ) {
      if (active.recoveringFromHydration && event.payload.notificationType === 'idle_prompt') {
        this.clearHydrationRecovery(active);
        this.emitStatus(active.conversation, 'completed');
      }
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
    if (
      !active.awaitingResponse &&
      !active.pendingTurn &&
      !active.awaitingInput &&
      !active.permissionResponseInFlight &&
      !active.recoveringFromHydration
    ) {
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
      active.permissionResponseInFlight = false;
      await this.cancelPendingPermissionRequests(active.conversation);
      this.emitStatus(active.conversation, 'idle');
      return;
    }

    active.awaitingInput = false;
    active.awaitingResponse = false;
    active.permissionResponseInFlight = false;
    active.pendingTurn = undefined;
    const status = event.exitCode === 0 ? 'completed' : 'error';
    if (active.recoveringFromHydration && status === 'error') {
      await this.restoreHydrationPermissionRecovery(active);
    } else if (active.recoveringFromHydration) {
      this.clearHydrationRecovery(active);
    } else {
      await this.cancelPendingPermissionRequests(active.conversation);
    }
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

  private async markCancelledUserMessage(
    conversation: Conversation,
    item: Awaited<ReturnType<typeof chatTimelineStore.appendUserMessage>>
  ): Promise<void> {
    try {
      await chatTimelineStore.markUserMessageCancelled(conversation, item);
    } catch (error) {
      log.warn('ChatConversationRuntime: failed to mark user message cancelled', {
        conversationId: conversation.id,
        error: String(error),
        itemId: item.id,
      });
    }
  }

  private async cancelPendingPermissionRequests(
    conversation: Conversation
  ): Promise<Awaited<ReturnType<typeof chatTimelineStore.cancelPendingPermissionRequests>>> {
    try {
      return await chatTimelineStore.cancelPendingPermissionRequests(conversation);
    } catch (error) {
      log.warn('ChatConversationRuntime: failed to cancel pending permission requests', {
        conversationId: conversation.id,
        error: String(error),
      });
      return [];
    }
  }

  private clearCurrentTurn(active: ActiveChatConversation, turnId: number): boolean {
    if (active.pendingTurn?.id === turnId) {
      active.pendingTurn = undefined;
      active.awaitingResponse = false;
      return true;
    }
    if (!active.pendingTurn && active.nextTurnId === turnId && !active.cancelled) {
      active.awaitingResponse = false;
      return true;
    }
    return false;
  }

  private isClearedCancelledTurn(active: ActiveChatConversation, turnId: number): boolean {
    return !active.pendingTurn && active.nextTurnId === turnId && active.cancelled === true;
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
    let duplicateResolvedPermissionRequest = false;
    let pendingPermissionRequestPersisted = false;
    const statuses: ConversationStatus[] = [];
    const mappedEvents = active.adapter.mapAgentEvent(event);
    for (const mapped of mappedEvents) {
      if (mapped.type === 'status') {
        statuses.push(mapped.status);
        continue;
      }

      const assistantText =
        mapped.item.kind === 'assistant_message' ? mapped.item.payload.text.trim() : undefined;
      if (assistantText && assistantText === active.lastAssistantMessage) continue;

      try {
        if (mapped.item.id) {
          const item =
            active.recoveringFromHydration &&
            mapped.item.kind === 'permission_request' &&
            mapped.item.payload.status === 'pending'
              ? await chatTimelineStore.reopenCancelledPermissionRequest(
                  active.conversation,
                  mapped.item,
                  active.recoveryCancelledPermissionIds ?? []
                )
              : await chatTimelineStore.append(active.conversation, mapped.item, { upsert: true });
          duplicateResolvedPermissionRequest =
            mapped.item.kind === 'permission_request' &&
            mapped.item.payload.status === 'pending' &&
            item?.kind === 'permission_request' &&
            item.status !== 'pending';
          pendingPermissionRequestPersisted =
            mapped.item.kind === 'permission_request' &&
            mapped.item.payload.status === 'pending' &&
            item !== undefined &&
            !duplicateResolvedPermissionRequest;
        } else {
          await chatTimelineStore.append(active.conversation, mapped.item);
          duplicateResolvedPermissionRequest = false;
          pendingPermissionRequestPersisted = false;
        }
      } catch (error) {
        log.warn('ChatConversationRuntime: failed to append mapped timeline item', {
          conversationId: active.conversation.id,
          error: String(error),
          kind: mapped.item.kind,
        });
        if (mapped.item.kind === 'permission_request' && mapped.item.payload.status === 'pending') {
          pendingPermissionRequestPersisted = false;
        }
        continue;
      }
      if (assistantText) {
        active.lastAssistantMessage = assistantText;
      }
    }

    for (const status of statuses) {
      if (status === 'awaiting-input' && duplicateResolvedPermissionRequest) {
        active.recoveringFromHydration = false;
        active.recoveryCancelledPermissionIds = undefined;
        continue;
      }
      if (status === 'awaiting-input' && !pendingPermissionRequestPersisted) {
        active.recoveringFromHydration = false;
        active.recoveryCancelledPermissionIds = undefined;
        continue;
      }
      if (
        !active.awaitingResponse &&
        ((status === 'completed' && !active.recoveringFromHydration) ||
          (status === 'awaiting-input' && !active.recoveringFromHydration))
      ) {
        if (status === 'completed' || status === 'awaiting-input') {
          active.recoveringFromHydration = false;
          active.recoveryCancelledPermissionIds = undefined;
        }
        continue;
      }
      this.emitStatus(active.conversation, status);
      if (status === 'completed' || status === 'error' || status === 'awaiting-input') {
        active.awaitingResponse = false;
      }
      if (status === 'awaiting-input') {
        active.awaitingInput = true;
        active.recoveringFromHydration = false;
        active.recoveryCancelledPermissionIds = undefined;
      } else if (status === 'completed' || status === 'error' || status === 'working') {
        if (status === 'completed' || status === 'error') {
          active.awaitingInput = false;
          active.recoveringFromHydration = false;
          active.recoveryCancelledPermissionIds = undefined;
        }
      }
      pendingPermissionRequestPersisted = false;
    }
  }

  async dehydrateTask(taskId: string): Promise<void> {
    const conversationsToDehydrate = Array.from(this.activeConversations).filter(
      ([, active]) => active.conversation.taskId === taskId
    );
    for (const [conversationId, active] of conversationsToDehydrate) {
      if (active.conversation.taskId === taskId) {
        if (!active.recoveringFromHydration) {
          await this.cancelPendingPermissionRequests(active.conversation);
        }
        await this.dehydrateConversation(conversationId);
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

  private async activateConversation(
    conversation: Conversation,
    options: { recoveringFromHydration?: boolean } = {}
  ): Promise<void> {
    await chatTimelineStore.recoverPendingUserMessages(conversation);
    const cancelledPermissions = await this.cancelPendingPermissionRequests(conversation);
    let lastAssistantMessage: string | undefined;
    try {
      lastAssistantMessage = await chatTimelineStore.getLatestAssistantMessage(conversation.id);
    } catch (error) {
      await this.restoreCancelledPermissionIds(
        conversation,
        cancelledPermissions.map((permission) => permission.id),
        'activation failure'
      );
      throw error;
    }
    this.activeConversations.set(conversation.id, {
      conversation,
      adapter: getChatProviderAdapter(conversation.providerId),
      backendExitVersion: 0,
      inputReady: false,
      lastAssistantMessage,
      nextTurnId: 0,
      recoveringFromHydration:
        (options.recoveringFromHydration ?? false) && cancelledPermissions.length > 0,
      recoveryCancelledPermissionIds: cancelledPermissions.map((permission) => permission.id),
    });
  }

  private async restoreHydrationPermissionRecovery(active: ActiveChatConversation): Promise<void> {
    if (!active.recoveringFromHydration) {
      this.clearHydrationRecovery(active);
      return;
    }
    const permissionIds = active.recoveryCancelledPermissionIds;
    this.clearHydrationRecovery(active);
    if (!permissionIds?.length) return;
    await this.restoreCancelledPermissionIds(
      active.conversation,
      permissionIds,
      'hydration permission recovery'
    );
  }

  private async revertPermissionResolutionBeforeBackendSend(
    conversation: Conversation,
    active: ActiveChatConversation,
    request: Awaited<ReturnType<typeof chatTimelineStore.getPendingPermissionRequest>>,
    options: { cancel: boolean; duringCancellation?: boolean }
  ): Promise<void> {
    try {
      await chatTimelineStore.restorePendingPermissionRequest(conversation, request);
      if (options.duringCancellation) {
        active.awaitingInput = true;
        active.permissionResponseRestoredDuringCancellation = true;
      }
      if (options.cancel) {
        await this.cancelPendingPermissionRequests(conversation);
      }
    } catch (error) {
      log.warn('ChatConversationRuntime: failed to revert unsent permission response resolution', {
        conversationId: active.conversation.id,
        error: String(error),
        requestId: request.requestId,
      });
    }
  }

  private async restoreCancelledPermissionIds(
    conversation: Conversation,
    permissionIds: string[],
    reason: string
  ): Promise<void> {
    if (permissionIds.length === 0) return;
    await chatTimelineStore
      .restoreCancelledPermissionRequests(conversation, permissionIds)
      .catch((error) => {
        log.warn('ChatConversationRuntime: failed to restore cancelled permission rows', {
          conversationId: conversation.id,
          error: String(error),
          reason,
        });
      });
  }

  private clearHydrationRecovery(active: ActiveChatConversation): void {
    active.recoveringFromHydration = false;
    active.recoveryCancelledPermissionIds = undefined;
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
