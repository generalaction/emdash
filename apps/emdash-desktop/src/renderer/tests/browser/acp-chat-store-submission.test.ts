import type { SessionState } from '@emdash/core/runtimes/acp/api/client';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChatUiRuntime } from '@core/features/conversations/api/browser/chat/chat-ui-runtime';
import { AcpChatStore } from '@core/features/conversations/browser/acp/acp-chat-store';
import { ACP_DRAFT_MAX_LENGTH } from '@core/features/conversations/contributions/mementos';

const mementoTestState = vi.hoisted(() => ({
  value: { version: '1' as const, text: '' },
  producer: null as null | (() => { version: '1'; text: string }),
}));

vi.mock('@core/features/conversations/api/browser/chat/shared-chat-context', () => ({
  getSharedChatContext: () => ({}),
}));

vi.mock('@core/primitives/mementos/browser', () => ({
  getMementoClient: () => ({
    reportError: vi.fn(),
    subject: () => ({
      ready: Promise.resolve(),
      release: vi.fn(async () => {}),
      handle: () => ({
        get value() {
          return mementoTestState.value;
        },
        autoPersist: vi.fn((producer) => {
          mementoTestState.producer = producer;
          return vi.fn();
        }),
      }),
    }),
  }),
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
    mementoTestState.value = { version: '1', text: '' };
    mementoTestState.producer = null;
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

  it('allows an explicit send to reconnect an inactive conversation', () => {
    const store = createStore(idleState(), vi.fn());
    store.session = null;
    store.loadError = {
      kind: 'inactive',
      message: 'This chat is inactive.',
    };

    expect(store.affordances.canSubmit).toBe(true);
  });

  it('reconnects and resends a prompt once when its activation was lost', async () => {
    const firstSession = {
      sendPrompt: vi.fn(async () => ({
        success: false as const,
        error: { type: 'stale_activation' as const, activationId: 'activation-old' },
      })),
    };
    const replacementSession = {
      sendPrompt: vi.fn(async () => ({ success: true as const, data: { queued: false } })),
    };
    const connectSession = vi
      .fn()
      .mockResolvedValueOnce(firstSession)
      .mockResolvedValueOnce(replacementSession);
    const loseSession = vi.fn();
    const toastError = vi.fn();
    const store = Object.assign(Object.create(AcpChatStore.prototype), {
      conversationId: 'conversation-1',
      hostAccess: undefined,
      _connectSession: connectSession,
      _loseSession: loseSession,
      _toastError: toastError,
    }) as AcpChatStore;

    await privateStore(store)._submitPrompt('hello', []);

    expect(loseSession).toHaveBeenCalledWith(firstSession);
    expect(connectSession).toHaveBeenCalledTimes(2);
    expect(firstSession.sendPrompt).toHaveBeenCalledWith({ text: 'hello' });
    expect(replacementSession.sendPrompt).toHaveBeenCalledWith({ text: 'hello' });
    expect(toastError).not.toHaveBeenCalled();
  });

  it('treats an activation-lost mutation as silent handle loss', async () => {
    const session = {};
    const connectSession = vi.fn(async () => session);
    const loseSession = vi.fn();
    const toastError = vi.fn();
    const store = Object.assign(Object.create(AcpChatStore.prototype), {
      hostAccess: undefined,
      _connectSession: connectSession,
      _loseSession: loseSession,
      _toastError: toastError,
    }) as AcpChatStore;

    await privateStore(store)._withConnectedSession('Failed to mutate', async () => ({
      success: false,
      error: { type: 'activation_missing', conversationId: 'conversation-1' },
    }));

    expect(loseSession).toHaveBeenCalledWith(session);
    expect(toastError).not.toHaveBeenCalled();
  });

  it('keeps a persisted draft across idle handle loss and store recreation', async () => {
    const store = createStore(idleState(), vi.fn());
    await Promise.resolve();
    const draft = 'd'.repeat(ACP_DRAFT_MAX_LENGTH + 10);
    store.setDraftText(draft);
    const currentSession = store.session!;

    privateStore(store)._loseSession(currentSession);
    expect(store.draftText).toBe(draft);
    if (!mementoTestState.producer) throw new Error('expected draft producer');
    mementoTestState.value = mementoTestState.producer();

    const replacement = new AcpChatStore('conversation-1', 'project-1', 'task-1');
    await vi.waitFor(() => expect(replacement.draftText).toHaveLength(ACP_DRAFT_MAX_LENGTH));
    expect(replacement.draftText).toBe(draft.slice(0, ACP_DRAFT_MAX_LENGTH));
    store.dispose();
    replacement.dispose();
  });
});

type PrivateStore = {
  _submitPrompt(text: string, attachments: []): Promise<void>;
  _loseSession(session: NonNullable<AcpChatStore['session']>): void;
  _withConnectedSession(
    title: string,
    work: (session: unknown) => Promise<{
      success: false;
      error: { type: 'activation_missing'; conversationId: string };
    }>
  ): Promise<void>;
};

function privateStore(store: AcpChatStore): PrivateStore {
  return store as unknown as PrivateStore;
}

function createStore(state: SessionState, sendPrompt: ReturnType<typeof vi.fn>) {
  const store = new AcpChatStore('conversation-1', 'project-1', 'task-1');
  store.session = {
    activationId: { current: () => 'activation-1' },
    sessionState: { current: () => state },
    sendPrompt,
    dispose: vi.fn(),
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
