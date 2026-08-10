import type { SessionState } from '@emdash/core/runtimes/acp/api/client';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChatUiRuntime } from '@core/features/conversations/api/browser/chat/chat-ui-runtime';
import { AcpChatStore } from '@core/features/conversations/browser/acp/acp-chat-store';

vi.mock('@core/features/conversations/api/browser/chat/shared-chat-context', () => ({
  getSharedChatContext: () => ({}),
}));

const setPendingPrompt = vi.fn();

describe('AcpChatStore prompt submission', () => {
  beforeAll(() => {
    installChatUiRuntime({
      createChatContext: () => ({}) as never,
      createChatState: () =>
        ({
          session: {
            state: { pendingPrompt: null },
            setPendingPrompt,
          },
          transcript: {
            state: { committedTurns: [], activeTurnSnapshot: null },
            history: { seed: vi.fn() },
          },
          scroll: { set: vi.fn() },
          dispose: vi.fn(),
        }) as never,
      createChatView: vi.fn() as never,
      connectSession: vi.fn() as never,
      pinTopMode: vi.fn(() => ({ kind: 'pin-top', itemId: 'optimistic' })) as never,
    });
  });

  beforeEach(() => {
    setPendingPrompt.mockClear();
  });

  it('stages the optimistic prompt before hidden context finishes resolving', async () => {
    let resolveContext!: (value: string | undefined) => void;
    const hiddenContext = new Promise<string | undefined>((resolve) => {
      resolveContext = resolve;
    });
    const sendPrompt = vi.fn(async () => ({ success: true, data: { queued: false } }));
    const store = createStore(idleState(), sendPrompt);

    store.submitPrompt('hello', [], hiddenContext);

    expect(setPendingPrompt).toHaveBeenCalledWith(expect.objectContaining({ text: 'hello' }));
    expect(sendPrompt).not.toHaveBeenCalled();

    resolveContext('resolved context');
    await vi.waitFor(() =>
      expect(sendPrompt).toHaveBeenCalledWith({
        text: 'hello',
        hiddenContext: 'resolved context',
      })
    );
  });

  it('still sends the prompt when optional issue context fails to resolve', async () => {
    const sendPrompt = vi.fn(async () => ({ success: true, data: { queued: false } }));
    const store = createStore(idleState(), sendPrompt);

    store.submitPrompt('hello', [], Promise.reject(new Error('context unavailable')));

    await vi.waitFor(() => expect(sendPrompt).toHaveBeenCalledWith({ text: 'hello' }));
  });

  it('does not cancel a queued prompt that was started from an idle queue', async () => {
    const state = idleState();
    state.queuedPrompts.push({
      id: 'queued-1',
      text: 'hello',
      createdAt: 1,
      updatedAt: 1,
    });
    const changeQueuePromptOrder = vi.fn(async () => ({ success: true, data: undefined }));
    const cancelTurn = vi.fn(async () => ({ success: true, data: undefined }));
    const store = createStore(state, vi.fn());
    Object.assign(store.session!, { changeQueuePromptOrder, cancelTurn });

    store.sendQueuedPromptNow('queued-1');

    await vi.waitFor(() => expect(changeQueuePromptOrder).toHaveBeenCalledWith(['queued-1']));
    expect(cancelTurn).not.toHaveBeenCalled();
  });
});

function createStore(state: SessionState, sendPrompt: ReturnType<typeof vi.fn>) {
  const store = new AcpChatStore('conversation-1', 'project-1', 'task-1');
  store.session = {
    sessionState: { current: () => state },
    sendPrompt,
  } as never;
  return store;
}

function idleState(): SessionState {
  return {
    lifecycle: 'ready',
    activeTurnId: null,
    pendingPermissions: [],
    lastStopReason: null,
    lastTurnErrored: false,
    queuedPrompts: [],
    agentTurnActive: false,
    backgroundAgentCount: 0,
    isGenerating: false,
    canSubmit: true,
    canCancel: false,
  };
}
