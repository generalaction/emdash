import { events, rpc } from '@renderer/lib/ipc';
import type { IDisposable } from '@renderer/lib/stores/lifecycle';
import { Resource } from '@renderer/lib/stores/resource';
import {
  type ConversationTimelineItem,
  type SendConversationMessageInput,
} from '@shared/conversation-timeline';
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
    const payload = typeof input === 'string' ? { text: input } : input;
    const { item } = await rpc.conversations.sendMessage(
      this.projectId,
      this.taskId,
      this.conversationId,
      payload
    );
    this.items.setValue(mergeTimelineItems(this.items.data ?? [], [item]));
    return item;
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
