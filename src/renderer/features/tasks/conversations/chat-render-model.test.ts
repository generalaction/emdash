import { describe, expect, it } from 'vitest';
import type { ConversationTimelineItem } from '@shared/conversation-timeline';
import { buildChatRenderItems } from './chat-render-model';

function baseFields(kind: ConversationTimelineItem['kind'], sequence: number) {
  return {
    id: `${kind}-${sequence}`,
    conversationId: 'conversation-1',
    sequence,
    createdAt: `2026-01-01T00:00:0${sequence}.000Z`,
  };
}

describe('buildChatRenderItems', () => {
  it('sorts timeline rows and keeps user messages distinct', () => {
    const items: ConversationTimelineItem[] = [
      { ...baseFields('assistant_message', 2), kind: 'assistant_message', text: 'answer' },
      { ...baseFields('user_message', 1), kind: 'user_message', text: 'question' },
    ];

    expect(buildChatRenderItems(items)).toMatchObject([
      { kind: 'message', role: 'user', text: 'question' },
      { kind: 'message', role: 'assistant', text: 'answer' },
    ]);
  });

  it('coalesces adjacent assistant and reasoning rows with stable first ids', () => {
    const items: ConversationTimelineItem[] = [
      { ...baseFields('assistant_message', 1), kind: 'assistant_message', text: 'first' },
      { ...baseFields('assistant_message', 2), kind: 'assistant_message', text: 'second' },
      { ...baseFields('reasoning', 3), kind: 'reasoning', text: 'thought one' },
      { ...baseFields('reasoning', 4), kind: 'reasoning', text: 'thought two' },
    ];

    expect(buildChatRenderItems(items)).toMatchObject([
      {
        kind: 'message',
        id: 'assistant_message-1',
        sourceIds: ['assistant_message-1', 'assistant_message-2'],
        role: 'assistant',
        text: 'first\n\nsecond',
      },
      {
        kind: 'reasoning',
        id: 'reasoning-3',
        sourceIds: ['reasoning-3', 'reasoning-4'],
        text: 'thought one\n\nthought two',
      },
    ]);
  });

  it('passes through tool calls, permissions, and errors', () => {
    const items: ConversationTimelineItem[] = [
      { ...baseFields('tool_call', 1), kind: 'tool_call', toolName: 'shell', status: 'running' },
      {
        ...baseFields('permission_request', 2),
        kind: 'permission_request',
        requestId: 'request-1',
        title: 'Run command',
        options: [{ id: 'approve', label: 'Approve' }],
        status: 'pending',
      },
      { ...baseFields('error', 3), kind: 'error', message: 'failed' },
    ];

    expect(buildChatRenderItems(items)).toMatchObject([
      { kind: 'tool_call', id: 'tool_call-1' },
      { kind: 'permission_request', id: 'permission_request-2' },
      { kind: 'error', id: 'error-3' },
    ]);
  });
});
