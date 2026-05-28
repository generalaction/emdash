import type {
  ConversationErrorTimelineItem,
  ConversationMessageTimelineItem,
  ConversationPermissionRequestTimelineItem,
  ConversationReasoningTimelineItem,
  ConversationTimelineItem,
  ConversationToolCallTimelineItem,
} from '@shared/conversation-timeline';

export type ChatRenderItem =
  | {
      kind: 'message';
      id: string;
      sourceIds: string[];
      role: 'user' | 'assistant';
      text: string;
      sequence: number;
      createdAt: string;
    }
  | {
      kind: 'reasoning';
      id: string;
      sourceIds: string[];
      text: string;
      sequence: number;
      createdAt: string;
    }
  | {
      kind: 'tool_call';
      id: string;
      item: ConversationToolCallTimelineItem;
    }
  | {
      kind: 'permission_request';
      id: string;
      item: ConversationPermissionRequestTimelineItem;
    }
  | {
      kind: 'error';
      id: string;
      item: ConversationErrorTimelineItem;
    };

export function buildChatRenderItems(items: ConversationTimelineItem[]): ChatRenderItem[] {
  const sorted = [...items].sort((a, b) => a.sequence - b.sequence);
  const renderItems: ChatRenderItem[] = [];

  for (const item of sorted) {
    switch (item.kind) {
      case 'assistant_message':
        coalesceMessage(renderItems, item, 'assistant');
        break;
      case 'reasoning':
        coalesceReasoning(renderItems, item);
        break;
      case 'user_message':
        renderItems.push(toMessageRenderItem(item, 'user'));
        break;
      case 'tool_call':
        renderItems.push({ kind: 'tool_call', id: item.id, item });
        break;
      case 'permission_request':
        renderItems.push({ kind: 'permission_request', id: item.id, item });
        break;
      case 'error':
        renderItems.push({ kind: 'error', id: item.id, item });
        break;
    }
  }

  return renderItems;
}

function coalesceMessage(
  renderItems: ChatRenderItem[],
  item: ConversationMessageTimelineItem,
  role: 'assistant'
): void {
  const previous = renderItems.at(-1);
  if (previous?.kind === 'message' && previous.role === role) {
    previous.sourceIds.push(item.id);
    previous.text = joinBlocks(previous.text, item.text);
    previous.sequence = item.sequence;
    return;
  }

  renderItems.push(toMessageRenderItem(item, role));
}

function coalesceReasoning(
  renderItems: ChatRenderItem[],
  item: ConversationReasoningTimelineItem
): void {
  const previous = renderItems.at(-1);
  if (previous?.kind === 'reasoning') {
    previous.sourceIds.push(item.id);
    previous.text = joinBlocks(previous.text, item.text);
    previous.sequence = item.sequence;
    return;
  }

  renderItems.push({
    kind: 'reasoning',
    id: item.id,
    sourceIds: [item.id],
    text: item.text,
    sequence: item.sequence,
    createdAt: item.createdAt,
  });
}

function toMessageRenderItem(
  item: ConversationMessageTimelineItem,
  role: 'user' | 'assistant'
): ChatRenderItem {
  return {
    kind: 'message',
    id: item.id,
    sourceIds: [item.id],
    role,
    text: item.text,
    sequence: item.sequence,
    createdAt: item.createdAt,
  };
}

function joinBlocks(left: string, right: string): string {
  if (!left) return right;
  if (!right) return left;
  return `${left}\n\n${right}`;
}
