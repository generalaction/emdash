// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationTimelineItem } from '@shared/conversation-timeline';
import type { Conversation } from '@shared/conversations';
import { ChatConversationPanel } from './chat-conversation-panel';
import type { ConversationStore } from './conversation-manager';

const conversationsRef = vi.hoisted(() => ({
  current: undefined as
    | {
        cancelTurn: ReturnType<typeof vi.fn>;
        sendMessage: ReturnType<typeof vi.fn>;
        timelines: Map<
          string,
          {
            items: { data: ConversationTimelineItem[]; error?: string; loading?: boolean };
            start: ReturnType<typeof vi.fn>;
          }
        >;
      }
    | undefined,
}));

vi.mock('@renderer/features/tasks/task-view-context', () => ({
  useConversations: () => conversationsRef.current,
}));

vi.mock('@renderer/lib/ui/markdown-renderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) =>
    React.createElement('div', { 'data-testid': 'markdown' }, content),
}));

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conversation-1',
    projectId: 'project-1',
    taskId: 'task-1',
    providerId: 'codex',
    title: 'Conversation 1',
    lastInteractedAt: null,
    isInitialConversation: false,
    runtimeMode: 'chat',
    ...overrides,
  };
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value'
  )?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(
    new window.InputEvent('input', { bubbles: true, inputType: 'insertText' })
  );
  textarea.dispatchEvent(new window.Event('change', { bubbles: true }));
}

function click(element: Element): void {
  element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}

function renderPanel(root: Root, conversation: Pick<ConversationStore, 'data' | 'status'>): void {
  root.render(
    React.createElement(ChatConversationPanel, {
      conversation: conversation as ConversationStore,
    })
  );
}

describe('ChatConversationPanel', () => {
  let root: Root;
  let container: HTMLDivElement;
  let sendMessage: ReturnType<typeof vi.fn>;
  let cancelTurn: ReturnType<typeof vi.fn>;
  let startTimeline: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    sendMessage = vi.fn().mockResolvedValue(undefined);
    cancelTurn = vi.fn().mockResolvedValue(undefined);
    startTimeline = vi.fn();
    conversationsRef.current = {
      cancelTurn,
      sendMessage,
      timelines: new Map([
        [
          'conversation-1',
          {
            items: { data: [] },
            start: startTimeline,
          },
        ],
      ]),
    };
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    conversationsRef.current = undefined;
    vi.unstubAllGlobals();
  });

  it('starts the timeline and sends an idle draft', async () => {
    const conversation = { data: makeConversation(), status: 'idle' as const };

    await act(async () => {
      renderPanel(root, conversation);
    });

    expect(startTimeline).toHaveBeenCalledTimes(1);
    const textarea = container.querySelector('textarea')!;
    await act(async () => {
      setTextareaValue(textarea, 'hello');
    });
    await act(async () => {
      click(container.querySelector('[aria-label="Send message"]')!);
    });

    expect(sendMessage).toHaveBeenCalledWith('conversation-1', 'hello');
  });

  it('disables sending and exposes cancellation while working', async () => {
    const conversation = { data: makeConversation(), status: 'working' as const };

    await act(async () => {
      renderPanel(root, conversation);
    });

    const textarea = container.querySelector('textarea')!;
    await act(async () => {
      setTextareaValue(textarea, 'hello');
      textarea.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    });

    expect(sendMessage).not.toHaveBeenCalled();
    expect(container.querySelector('[aria-label="Send message"]')).toBeNull();

    await act(async () => {
      click(container.querySelector('[aria-label="Cancel turn"]')!);
    });

    expect(cancelTurn).toHaveBeenCalledWith('conversation-1');
  });

  it('disables sending and exposes cancellation while awaiting provider input', async () => {
    const conversation = { data: makeConversation(), status: 'awaiting-input' as const };

    await act(async () => {
      renderPanel(root, conversation);
    });

    const textarea = container.querySelector('textarea')!;
    await act(async () => {
      setTextareaValue(textarea, 'hello');
      textarea.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    });

    expect(sendMessage).not.toHaveBeenCalled();
    expect(container.querySelector('[aria-label="Send message"]')).toBeNull();

    await act(async () => {
      click(container.querySelector('[aria-label="Cancel turn"]')!);
    });

    expect(cancelTurn).toHaveBeenCalledWith('conversation-1');
  });

  it('renders assistant messages through markdown', async () => {
    conversationsRef.current?.timelines.set('conversation-1', {
      items: {
        data: [
          {
            id: 'assistant-1',
            conversationId: 'conversation-1',
            sequence: 1,
            createdAt: '2026-01-01T00:00:00.000Z',
            kind: 'assistant_message',
            text: '**done**',
          },
        ],
      },
      start: startTimeline,
    });
    const conversation = { data: makeConversation(), status: 'idle' as const };

    await act(async () => {
      renderPanel(root, conversation);
    });

    expect(container.querySelector('[data-testid="markdown"]')?.textContent).toBe('**done**');
  });
});
