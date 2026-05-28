import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Conversation } from '@shared/conversations';
import { ConversationsPanel } from './conversations-panel';

const activeConversationRef = vi.hoisted(() => ({
  current: undefined as { data: Conversation } | undefined,
}));

vi.mock('@renderer/features/tasks/tabs/tab-group-context', () => ({
  useTabGroupContext: () => ({
    tabManager: {
      activeConversation: activeConversationRef.current,
    },
  }),
}));

vi.mock('./chat-conversation-panel', () => ({
  ChatConversationPanel: () => 'chat-panel',
}));

vi.mock('./terminal-conversation-panel', () => ({
  TerminalConversationPanel: () => 'terminal-panel',
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
    runtimeMode: 'terminal',
    ...overrides,
  };
}

describe('ConversationsPanel', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    container = dom.window.document.getElementById('root') as HTMLDivElement;
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    activeConversationRef.current = undefined;
    vi.unstubAllGlobals();
    dom.window.close();
  });

  it('renders the terminal panel when no conversation is active', () => {
    act(() => {
      root.render(React.createElement(ConversationsPanel));
    });

    expect(container.textContent).toBe('terminal-panel');
  });

  it('renders the chat panel only when a runnable chat runtime is active', () => {
    activeConversationRef.current = { data: makeConversation({ runtimeMode: 'chat' }) };

    act(() => {
      root.render(React.createElement(ConversationsPanel));
    });

    expect(container.textContent).toBe('chat-panel');
  });

  it('renders the terminal panel for terminal-only chat rows', () => {
    activeConversationRef.current = {
      data: makeConversation({ providerId: 'grok', runtimeMode: 'chat' }),
    };

    act(() => {
      root.render(React.createElement(ConversationsPanel));
    });

    expect(container.textContent).toBe('terminal-panel');
  });
});
