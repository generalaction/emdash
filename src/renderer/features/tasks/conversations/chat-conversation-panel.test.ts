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
        executeCommand: ReturnType<typeof vi.fn>;
        listCommands: ReturnType<typeof vi.fn>;
        respondToPermission: ReturnType<typeof vi.fn>;
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

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
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
  let executeCommand: ReturnType<typeof vi.fn>;
  let listCommands: ReturnType<typeof vi.fn>;
  let respondToPermission: ReturnType<typeof vi.fn>;
  let startTimeline: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    sendMessage = vi.fn().mockResolvedValue(undefined);
    cancelTurn = vi.fn().mockResolvedValue(undefined);
    executeCommand = vi.fn().mockResolvedValue(undefined);
    listCommands = vi.fn().mockResolvedValue([]);
    respondToPermission = vi.fn().mockResolvedValue(undefined);
    startTimeline = vi.fn();
    conversationsRef.current = {
      cancelTurn,
      executeCommand,
      listCommands,
      respondToPermission,
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

  it('uses command RPC for recognized slash commands', async () => {
    listCommands.mockResolvedValue([{ name: 'compact', description: 'Compact context' }]);
    const conversation = { data: makeConversation(), status: 'idle' as const };

    await act(async () => {
      renderPanel(root, conversation);
    });

    const textarea = container.querySelector('textarea')!;
    await act(async () => {
      setTextareaValue(textarea, '/compact');
    });
    await act(async () => {
      click(container.querySelector('[aria-label="Send message"]')!);
    });

    expect(listCommands).toHaveBeenCalledWith('conversation-1');
    expect(executeCommand).toHaveBeenCalledWith('conversation-1', { name: 'compact' });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('shows slash command suggestions and inserts the selected command', async () => {
    listCommands.mockResolvedValue([
      { name: 'compact', description: 'Compact context' },
      { name: 'goal', description: 'Update goal' },
    ]);
    const conversation = { data: makeConversation(), status: 'idle' as const };

    await act(async () => {
      renderPanel(root, conversation);
    });

    const textarea = container.querySelector('textarea')!;
    await act(async () => {
      setTextareaValue(textarea, '/c');
    });
    await act(async () => {
      await Promise.resolve();
    });

    const commandMenu = container.querySelector('[role="listbox"]')!;
    expect(commandMenu.textContent).toContain('/compact');
    expect(commandMenu.textContent).not.toContain('/goal');

    const compactOption = Array.from(commandMenu.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('/compact')
    )!;
    await act(async () => {
      click(compactOption);
    });

    expect(textarea.value).toBe('/compact ');

    await act(async () => {
      click(container.querySelector('[aria-label="Send message"]')!);
    });

    expect(executeCommand).toHaveBeenCalledWith('conversation-1', { name: 'compact' });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('uses Enter to select the highlighted slash command suggestion', async () => {
    listCommands.mockResolvedValue([
      { name: 'compact', description: 'Compact context' },
      { name: 'goal', description: 'Update goal' },
    ]);
    const conversation = { data: makeConversation(), status: 'idle' as const };

    await act(async () => {
      renderPanel(root, conversation);
    });

    const textarea = container.querySelector('textarea')!;
    await act(async () => {
      setTextareaValue(textarea, '/c');
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      textarea.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    });

    expect(textarea.value).toBe('/compact ');
    expect(sendMessage).not.toHaveBeenCalled();
    expect(executeCommand).not.toHaveBeenCalled();

    await act(async () => {
      textarea.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    });

    expect(executeCommand).toHaveBeenCalledWith('conversation-1', { name: 'compact' });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('does not reload command suggestions for each slash query edit', async () => {
    listCommands.mockResolvedValue([
      { name: 'compact', description: 'Compact context' },
      { name: 'goal', description: 'Update goal' },
    ]);
    const conversation = { data: makeConversation(), status: 'idle' as const };

    await act(async () => {
      renderPanel(root, conversation);
    });

    const textarea = container.querySelector('textarea')!;
    await act(async () => {
      setTextareaValue(textarea, '/');
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      setTextareaValue(textarea, '/c');
      setTextareaValue(textarea, '/co');
    });

    expect(listCommands).toHaveBeenCalledTimes(1);
  });

  it('sends unrecognized slash text as a normal message', async () => {
    listCommands.mockResolvedValue([{ name: 'compact', description: 'Compact context' }]);
    const conversation = { data: makeConversation(), status: 'idle' as const };

    await act(async () => {
      renderPanel(root, conversation);
    });

    const textarea = container.querySelector('textarea')!;
    await act(async () => {
      setTextareaValue(textarea, '/unknown arg');
    });
    await act(async () => {
      click(container.querySelector('[aria-label="Send message"]')!);
    });

    expect(executeCommand).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith('conversation-1', '/unknown arg');
  });

  it('uses Enter to send and Shift+Enter to keep editing', async () => {
    const conversation = { data: makeConversation(), status: 'idle' as const };

    await act(async () => {
      renderPanel(root, conversation);
    });

    const textarea = container.querySelector('textarea')!;
    await act(async () => {
      setTextareaValue(textarea, 'hello');
      textarea.dispatchEvent(
        new window.KeyboardEvent('keydown', { bubbles: true, key: 'Enter', shiftKey: true })
      );
    });
    expect(sendMessage).not.toHaveBeenCalled();

    await act(async () => {
      textarea.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    });

    expect(sendMessage).toHaveBeenCalledWith('conversation-1', 'hello');
  });

  it('does not submit while IME composition is active', async () => {
    const conversation = { data: makeConversation(), status: 'idle' as const };

    await act(async () => {
      renderPanel(root, conversation);
    });

    const textarea = container.querySelector('textarea')!;
    await act(async () => {
      setTextareaValue(textarea, '変換');
      textarea.dispatchEvent(
        new window.KeyboardEvent('keydown', {
          bubbles: true,
          isComposing: true,
          key: 'Enter',
        } as KeyboardEventInit)
      );
    });

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('prevents duplicate sends while the composer submit is pending', async () => {
    const send = deferred();
    sendMessage.mockReturnValueOnce(send.promise);
    const conversation = { data: makeConversation(), status: 'idle' as const };

    await act(async () => {
      renderPanel(root, conversation);
    });

    const textarea = container.querySelector('textarea')!;
    await act(async () => {
      setTextareaValue(textarea, 'hello');
    });
    await act(async () => {
      click(container.querySelector('[aria-label="Send message"]')!);
      click(container.querySelector('[aria-label="Send message"]')!);
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);

    await act(async () => {
      send.resolve();
      await send.promise;
    });
  });

  it('keeps cancellation available and ignores send cancellation after submit turns working', async () => {
    const send = deferred();
    sendMessage.mockReturnValueOnce(send.promise);
    const idleConversation = { data: makeConversation(), status: 'idle' as const };
    const workingConversation = { data: makeConversation(), status: 'working' as const };

    await act(async () => {
      renderPanel(root, idleConversation);
    });

    const textarea = container.querySelector('textarea')!;
    await act(async () => {
      setTextareaValue(textarea, 'hello');
    });
    await act(async () => {
      click(container.querySelector('[aria-label="Send message"]')!);
    });
    await act(async () => {
      renderPanel(root, workingConversation);
    });

    const cancelButton = container.querySelector<HTMLButtonElement>('[aria-label="Cancel turn"]')!;
    expect(cancelButton.disabled).toBe(false);

    await act(async () => {
      click(cancelButton);
    });

    expect(cancelTurn).toHaveBeenCalledWith('conversation-1');

    await act(async () => {
      send.reject(new Error('Message send was cancelled'));
      await send.promise.catch(() => {});
    });
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('does not restore a cancelled draft when the pending send rejects as cancelled', async () => {
    const send = deferred();
    sendMessage.mockReturnValueOnce(send.promise);
    const idleConversation = { data: makeConversation(), status: 'idle' as const };
    const workingConversation = { data: makeConversation(), status: 'working' as const };

    await act(async () => {
      renderPanel(root, idleConversation);
    });

    const textarea = container.querySelector('textarea')!;
    await act(async () => {
      setTextareaValue(textarea, 'cancel me');
    });
    await act(async () => {
      click(container.querySelector('[aria-label="Send message"]')!);
    });
    await act(async () => {
      renderPanel(root, workingConversation);
    });
    await act(async () => {
      click(container.querySelector('[aria-label="Cancel turn"]')!);
    });
    await act(async () => {
      renderPanel(root, idleConversation);
    });
    await act(async () => {
      setTextareaValue(textarea, 'new prompt');
    });
    await act(async () => {
      click(container.querySelector('[aria-label="Send message"]')!);
    });

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenLastCalledWith('conversation-1', 'new prompt');

    await act(async () => {
      send.reject(new Error('Message send was cancelled'));
      await Promise.resolve();
    });

    expect(textarea.value).toBe('');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('ignores Electron-wrapped send cancellation errors', async () => {
    sendMessage.mockRejectedValueOnce(
      new Error('Error invoking remote method: Error: Message send was cancelled')
    );
    const conversation = { data: makeConversation(), status: 'idle' as const };

    await act(async () => {
      renderPanel(root, conversation);
    });

    const textarea = container.querySelector('textarea')!;
    await act(async () => {
      setTextareaValue(textarea, 'hello');
    });
    await act(async () => {
      click(container.querySelector('[aria-label="Send message"]')!);
    });

    expect(textarea.value).toBe('');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('restores the draft and shows send errors', async () => {
    sendMessage.mockRejectedValueOnce(new Error('send failed'));
    const conversation = { data: makeConversation(), status: 'idle' as const };

    await act(async () => {
      renderPanel(root, conversation);
    });

    const textarea = container.querySelector('textarea')!;
    await act(async () => {
      setTextareaValue(textarea, 'hello');
    });
    await act(async () => {
      click(container.querySelector('[aria-label="Send message"]')!);
    });

    expect(textarea.value).toBe('hello');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('send failed');
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

  it('allows cancellation after a send switches the conversation to working while send is pending', async () => {
    const send = deferred();
    sendMessage.mockReturnValueOnce(send.promise);
    const conversation = { data: makeConversation(), status: 'idle' as const };

    await act(async () => {
      renderPanel(root, conversation);
    });

    const textarea = container.querySelector('textarea')!;
    await act(async () => {
      setTextareaValue(textarea, 'hello');
    });
    await act(async () => {
      click(container.querySelector('[aria-label="Send message"]')!);
    });

    await act(async () => {
      renderPanel(root, { ...conversation, status: 'working' as const });
    });

    const cancelButton = container.querySelector('[aria-label="Cancel turn"]') as HTMLButtonElement;
    expect(cancelButton.disabled).toBe(false);

    await act(async () => {
      click(cancelButton);
    });

    expect(cancelTurn).toHaveBeenCalledWith('conversation-1');
    send.resolve();
    await act(async () => {
      await send.promise;
    });
  });

  it('shows cancel errors without clearing the draft', async () => {
    cancelTurn.mockRejectedValueOnce(new Error('cancel failed'));
    const conversation = { data: makeConversation(), status: 'working' as const };

    await act(async () => {
      renderPanel(root, conversation);
    });

    const textarea = container.querySelector('textarea')!;
    await act(async () => {
      setTextareaValue(textarea, 'next');
    });
    await act(async () => {
      click(container.querySelector('[aria-label="Cancel turn"]')!);
    });

    expect(textarea.value).toBe('next');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('cancel failed');
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

  it('responds to pending permission cards and keeps errors inline', async () => {
    respondToPermission.mockRejectedValueOnce(new Error('permission failed'));
    conversationsRef.current?.timelines.set('conversation-1', {
      items: {
        data: [
          {
            id: 'permission-item-1',
            conversationId: 'conversation-1',
            sequence: 1,
            createdAt: '2026-01-01T00:00:00.000Z',
            kind: 'permission_request',
            requestId: 'permission-1',
            title: 'Run command?',
            body: 'Codex wants to run pnpm test.',
            options: [
              { id: 'approve', label: 'Approve', kind: 'primary' },
              { id: 'deny', label: 'Deny', kind: 'danger' },
            ],
            status: 'pending',
          },
        ],
      },
      start: startTimeline,
    });
    const conversation = { data: makeConversation(), status: 'awaiting-input' as const };

    await act(async () => {
      renderPanel(root, conversation);
    });

    const approveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Approve'
    )!;
    await act(async () => {
      click(approveButton);
    });

    expect(respondToPermission).toHaveBeenCalledWith('conversation-1', {
      requestId: 'permission-1',
      optionId: 'approve',
      answers: undefined,
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('permission failed');
  });

  it('submits answers for Codex question permission cards', async () => {
    conversationsRef.current?.timelines.set('conversation-1', {
      items: {
        data: [
          {
            id: 'permission-item-1',
            conversationId: 'conversation-1',
            sequence: 1,
            createdAt: '2026-01-01T00:00:00.000Z',
            kind: 'permission_request',
            requestId: 'permission-1',
            title: 'Question',
            input: {
              questions: [
                {
                  id: 'confirm',
                  header: 'Confirm',
                  question: 'Proceed?',
                  options: [{ label: 'Yes (Recommended)' }, { label: 'No' }],
                },
              ],
            },
            options: [
              { id: 'approve', label: 'Approve', kind: 'primary' },
              { id: 'deny', label: 'Deny', kind: 'danger' },
            ],
            status: 'pending',
          },
        ],
      },
      start: startTimeline,
    });
    const conversation = { data: makeConversation(), status: 'awaiting-input' as const };

    await act(async () => {
      renderPanel(root, conversation);
    });

    const select = container.querySelector('select')!;
    await act(async () => {
      select.value = 'No';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const approveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Approve'
    )!;
    await act(async () => {
      click(approveButton);
    });

    expect(respondToPermission).toHaveBeenCalledWith('conversation-1', {
      requestId: 'permission-1',
      optionId: 'approve',
      answers: { confirm: 'No' },
    });
  });

  it('submits multiple answers for Codex multi-select question permission cards', async () => {
    conversationsRef.current?.timelines.set('conversation-1', {
      items: {
        data: [
          {
            id: 'permission-item-1',
            conversationId: 'conversation-1',
            sequence: 1,
            createdAt: '2026-01-01T00:00:00.000Z',
            kind: 'permission_request',
            requestId: 'permission-1',
            title: 'Question',
            input: {
              questions: [
                {
                  id: 'steps',
                  header: 'Steps',
                  multiSelect: true,
                  options: [{ label: 'Run tests' }, { label: 'Update docs' }],
                },
              ],
            },
            options: [
              { id: 'approve', label: 'Approve', kind: 'primary' },
              { id: 'deny', label: 'Deny', kind: 'danger' },
            ],
            status: 'pending',
          },
        ],
      },
      start: startTimeline,
    });
    const conversation = { data: makeConversation(), status: 'awaiting-input' as const };

    await act(async () => {
      renderPanel(root, conversation);
    });

    const checkboxes = Array.from(container.querySelectorAll('input[type="checkbox"]'));
    await act(async () => {
      for (const checkbox of checkboxes) {
        click(checkbox);
      }
    });

    const approveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Approve'
    )!;
    await act(async () => {
      click(approveButton);
    });

    expect(respondToPermission).toHaveBeenCalledWith('conversation-1', {
      requestId: 'permission-1',
      optionId: 'approve',
      answers: { steps: ['Run tests', 'Update docs'] },
    });
  });
});
