import { events, rpc } from '@renderer/lib/ipc';
import type { IDisposable } from '@renderer/lib/stores/lifecycle';
import { Resource } from '@renderer/lib/stores/resource';
import {
  type ConversationPermissionResponse,
  type ConversationMessageTimelineItem,
  type ConversationTimelineItem,
  type SendConversationMessageInput,
} from '@shared/conversation-timeline';

type NormalizedSendMessageInput = SendConversationMessageInput & { messageId: string };
import { conversationTimelineEventChannel } from '@shared/events/conversationEvents';

export class ConversationTimelineStore implements IDisposable {
  readonly items: Resource<ConversationTimelineItem[], { item: ConversationTimelineItem }>;
  private started = false;

  constructor(
    private readonly projectId: string,
    private readonly taskId: string,
    private readonly conversationId: string
  ) {
    this.items = new Resource<ConversationTimelineItem[], { item: ConversationTimelineItem }>(
      () => this.fetchTimeline(),
      [
        { kind: 'demand' },
        {
          kind: 'event',
          subscribe: (handler) =>
            events.on(conversationTimelineEventChannel, (event) => {
              if (
                event.projectId !== projectId ||
                event.taskId !== taskId ||
                event.conversationId !== conversationId
              ) {
                return;
              }
              handler({ item: event.item });
            }),
          onEvent: ({ item }, ctx) => ctx.set(mergeTimelineItems(ctx.data ?? [], [item])),
        },
      ],
      { init: [] }
    );
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.items.start();
  }

  load(): Promise<void> {
    return this.items.load();
  }

  async sendMessage(
    input: SendConversationMessageInput | string
  ): Promise<ConversationTimelineItem> {
    const payload = normalizeMessageInput(input);
    const optimisticItem = this.createOptimisticUserMessage(payload);
    this.items.setValue(mergeTimelineItems(this.items.data ?? [], [optimisticItem]));

    try {
      const { item } = await rpc.conversations.sendMessage(
        this.projectId,
        this.taskId,
        this.conversationId,
        payload
      );
      if (item) {
        this.items.setValue(mergeTimelineItems(this.items.data ?? [], [item]));
        return item;
      }
      this.items.setValue(removeOptimisticTimelineItem(this.items.data ?? [], optimisticItem));
      return optimisticItem;
    } catch (error) {
      this.items.setValue(removeOptimisticTimelineItem(this.items.data ?? [], optimisticItem));
      throw error;
    }
  }

  async cancelTurn(): Promise<void> {
    await rpc.conversations.cancelTurn(this.projectId, this.taskId, this.conversationId);
  }

  async listCommands(): Promise<Array<{ name: string; description?: string }>> {
    return rpc.conversations.listCommands(this.projectId, this.taskId, this.conversationId);
  }

  async executeCommand(command: { name: string; args?: string }): Promise<void> {
    await rpc.conversations.executeCommand(
      this.projectId,
      this.taskId,
      this.conversationId,
      command
    );
  }

  async respondToPermission(response: ConversationPermissionResponse): Promise<void> {
    await rpc.conversations.respondToPermission(
      this.projectId,
      this.taskId,
      this.conversationId,
      response
    );
  }

  dispose(): void {
    this.items.dispose();
  }

  private async fetchTimeline(): Promise<ConversationTimelineItem[]> {
    const fetched = await rpc.conversations.getTimeline(
      this.projectId,
      this.taskId,
      this.conversationId
    );
    return mergeTimelineItems(this.items.data ?? [], fetched);
  }

  private createOptimisticUserMessage(
    input: NormalizedSendMessageInput
  ): ConversationMessageTimelineItem {
    const items = this.items.data ?? [];
    const maxSequence = items.reduce((max, item) => Math.max(max, item.sequence), 0);
    return {
      id: input.messageId,
      conversationId: this.conversationId,
      kind: 'user_message',
      sequence: maxSequence + 1,
      text: input.text.trim(),
      createdAt: new Date().toISOString(),
    };
  }
}

function normalizeMessageInput(
  input: SendConversationMessageInput | string
): NormalizedSendMessageInput {
  const payload = typeof input === 'string' ? { text: input } : input;
  const text = payload.text.trim();
  if (!text) throw new Error('Message text is required');
  return {
    ...payload,
    messageId: payload.messageId ?? createClientMessageId(),
    text,
  };
}

function createClientMessageId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `message-${Date.now()}-${Math.random()}`;
}

function upsertTimelineItem(
  items: ConversationTimelineItem[],
  item: ConversationTimelineItem
): ConversationTimelineItem[] {
  const existingIndex = items.findIndex((existing) => existing.id === item.id);
  const next =
    existingIndex === -1
      ? [...items, item]
      : items.map((existing, index) => (index === existingIndex ? item : existing));
  return next.sort((a, b) => a.sequence - b.sequence);
}

function mergeTimelineItems(
  current: ConversationTimelineItem[],
  fetched: ConversationTimelineItem[]
): ConversationTimelineItem[] {
  let next = current;
  for (const item of fetched) {
    next = upsertTimelineItem(next, item);
  }
  return next;
}

function removeOptimisticTimelineItem(
  items: ConversationTimelineItem[],
  optimisticItem: ConversationMessageTimelineItem
): ConversationTimelineItem[] {
  return items.filter(
    (item) =>
      item.id !== optimisticItem.id ||
      item.sequence !== optimisticItem.sequence ||
      item.createdAt !== optimisticItem.createdAt
  );
}
