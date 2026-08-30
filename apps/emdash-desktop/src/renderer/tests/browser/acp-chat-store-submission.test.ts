import type { HistoryPage, SessionState } from '@emdash/core/runtimes/acp/api/client';
import { observable, runInAction } from 'mobx';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChatUiRuntime } from '@core/features/conversations/api/browser/chat/chat-ui-runtime';
import {
  AcpChatStore,
  type AcpPromptAttachment,
} from '@core/features/conversations/browser/acp/acp-chat-store';
import { AcpLiveSession } from '@core/features/conversations/browser/acp/acp-live-session';
import type {
  ProjectHostAccess,
  ProjectHostAccessState,
} from '@core/features/projects/api/browser/stores/project-context';

type DraftState = {
  version: '1';
  text: string;
  attachments: Array<{ id: string; mimeType: 'image/png'; name?: string }>;
};

const mementoTestState = vi.hoisted(() => ({
  value: { version: '1' as const, text: '', attachments: [] } as DraftState,
  producer: null as null | (() => DraftState),
  ready: Promise.resolve() as Promise<void>,
  reportError: vi.fn(),
}));

const conversationClientTestState = vi.hoisted(() => ({
  uploadAttachment: vi.fn(),
  downloadAttachment: vi.fn(),
  deleteAttachment: vi.fn(),
}));

vi.mock('@core/features/conversations/api/browser/chat/shared-chat-context', () => ({
  getSharedChatContext: () => ({}),
}));

vi.mock('@core/features/conversations/api/browser/client', () => ({
  getConversationsClient: async () => ({ acp: conversationClientTestState }),
}));

vi.mock('@core/primitives/mementos/browser', () => ({
  getMementoClient: () => ({
    reportError: mementoTestState.reportError,
    subject: () => ({
      get ready() {
        return mementoTestState.ready;
      },
      release: vi.fn(async () => {}),
      handle: () => ({
        get value() {
          return mementoTestState.value;
        },
        autoPersist: vi.fn((producer: () => DraftState) => {
          mementoTestState.producer = producer;
          return vi.fn();
        }),
      }),
    }),
  }),
}));

const chatSessionTestState = {
  pendingPrompt: null as { id: string; text: string } | null,
};
const setPendingPrompt = vi.fn((prompt: { id: string; text: string } | null) => {
  chatSessionTestState.pendingPrompt = prompt;
});
const transcriptTestState = {
  committedTurns: [] as HistoryPage['turns'],
  activeTurnSnapshot: null as HistoryPage['turns'][number] | null,
};
const historySeed = vi.fn((turns: HistoryPage['turns']) => {
  transcriptTestState.committedTurns = turns;
});
let connectSessionOptions: { onTurnCommitted?: () => void } | undefined;
const connectSession = vi.fn(
  (_state: unknown, _source: unknown, options: { onTurnCommitted?: () => void } | undefined) => {
    connectSessionOptions = options;
    return vi.fn();
  }
);

describe('AcpChatStore prompt submission', () => {
  beforeAll(() => {
    installChatUiRuntime({
      createChatContext: () => ({}) as never,
      createChatState: () =>
        ({
          session: {
            state: chatSessionTestState,
            setPendingPrompt,
          },
          transcript: {
            state: transcriptTestState,
            history: { seed: historySeed },
          },
          scroll: { set: vi.fn() },
          dispose: vi.fn(),
        }) as never,
      createChatView: vi.fn() as never,
      connectSession: connectSession as never,
      pinTopMode: vi.fn(() => ({ kind: 'pin-top', itemId: 'optimistic' })) as never,
    });
  });

  beforeEach(() => {
    setPendingPrompt.mockClear();
    chatSessionTestState.pendingPrompt = null;
    transcriptTestState.committedTurns = [];
    transcriptTestState.activeTurnSnapshot = null;
    historySeed.mockClear();
    historySeed.mockImplementation((turns) => {
      transcriptTestState.committedTurns = turns;
    });
    connectSession.mockClear();
    connectSessionOptions = undefined;
    mementoTestState.value = { version: '1', text: '', attachments: [] };
    mementoTestState.producer = null;
    mementoTestState.ready = Promise.resolve();
    mementoTestState.reportError.mockClear();
    conversationClientTestState.uploadAttachment.mockReset();
    conversationClientTestState.downloadAttachment.mockReset();
    conversationClientTestState.deleteAttachment.mockReset();
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
    store.setDraftText('hello');

    store.submitPrompt('hello', [], Promise.reject(new Error('context unavailable')));

    await vi.waitFor(() => expect(sendPrompt).toHaveBeenCalledWith({ text: 'hello' }));
    expect(store.draftText).toBe('');
  });

  it('reconciles a prompt when authoritative history arrives without live turn updates', async () => {
    let finishPrompt!: () => void;
    const sendPrompt = vi.fn(
      () =>
        new Promise<{ success: true; data: { queued: false } }>((resolve) => {
          finishPrompt = () => resolve({ success: true, data: { queued: false } });
        })
    );
    const live = fakeLiveSession(idleState(), historyPage('before'), { sendPrompt });
    const store = await bootstrapWithSession(live.session);
    live.loadHistory.mockClear();
    historySeed.mockClear();

    store.submitPrompt('survived disconnect');
    await vi.waitFor(() => expect(sendPrompt).toHaveBeenCalled());
    expect(chatSessionTestState.pendingPrompt).toMatchObject({ text: 'survived disconnect' });

    live.loadHistory.mockResolvedValueOnce({
      success: true,
      data: historyPageWithPrompt('completed', 1, 'survived disconnect'),
    });
    finishPrompt();

    await vi.waitFor(() => expect(live.loadHistory).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(chatSessionTestState.pendingPrompt).toBeNull());
    expect(historySeed).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'completed', seq: 1 }),
    ]);
    store.dispose();
  });

  it('does not reconcile against an identical prompt from earlier history', async () => {
    const text = 'continue';
    const priorHistory = historyPageWithPrompt('prior', 0, text);
    const live = fakeLiveSession(idleState(), priorHistory);
    const store = await bootstrapWithSession(live.session);
    live.loadHistory.mockClear();
    live.loadHistory.mockResolvedValueOnce({ success: true, data: priorHistory });

    store.submitPrompt(text);

    await vi.waitFor(() => expect(live.loadHistory).toHaveBeenCalledTimes(1));
    expect(chatSessionTestState.pendingPrompt).toMatchObject({ text });
    store.dispose();
  });

  it('restores the persisted draft when the live session is unavailable', async () => {
    const store = createStore(idleState(), vi.fn());
    const attachment = promptAttachment('attachment-no-session', 'data:image/png;base64,AQ==');
    store.session = null;
    store.setDraftText('retry me');
    store.addDraftAttachments([attachment]);

    store.submitPrompt(store.draftText, store.draftAttachments);

    await vi.waitFor(() => expect(store.draftText).toBe('retry me'));
    expect(store.draftAttachments).toEqual([attachment]);
    expect(setPendingPrompt).toHaveBeenLastCalledWith(null);
    expect(mementoTestState.producer?.()).toEqual({
      version: '1',
      text: 'retry me',
      attachments: [
        {
          id: 'attachment-no-session',
          mimeType: 'image/png',
          name: 'attachment-no-session.png',
        },
      ],
    });
  });

  it('restores the persisted draft when prompt delivery is rejected', async () => {
    const sendPrompt = vi.fn(async () => ({
      success: false as const,
      error: { type: 'invalid_state' as const, message: 'session unavailable' },
    }));
    const store = createStore(idleState(), sendPrompt);
    const attachment = promptAttachment('attachment-rejected', 'data:image/png;base64,AQ==');
    store.setDraftText('retry me');
    store.addDraftAttachments([attachment]);

    store.submitPrompt(store.draftText, store.draftAttachments);

    await vi.waitFor(() => expect(sendPrompt).toHaveBeenCalled());
    await vi.waitFor(() => expect(store.draftText).toBe('retry me'));
    expect(store.draftAttachments).toEqual([attachment]);
  });

  it('restores the persisted draft when prompt delivery throws', async () => {
    const sendPrompt = vi.fn(async () => {
      throw new Error('connection lost');
    });
    const store = createStore(idleState(), sendPrompt);
    store.setDraftText('retry me');

    store.submitPrompt(store.draftText);

    await vi.waitFor(() => expect(sendPrompt).toHaveBeenCalled());
    await vi.waitFor(() => expect(store.draftText).toBe('retry me'));
  });

  it('does not overwrite newer composer input when an earlier delivery is rejected', async () => {
    let rejectDelivery!: (result: {
      success: false;
      error: { type: 'invalid_state'; message: string };
    }) => void;
    const sendPrompt = vi.fn(
      () =>
        new Promise<{
          success: false;
          error: { type: 'invalid_state'; message: string };
        }>((resolve) => {
          rejectDelivery = resolve;
        })
    );
    const store = createStore(idleState(), sendPrompt);
    store.setDraftText('first draft');

    store.submitPrompt(store.draftText);
    store.setDraftText('newer draft');
    await vi.waitFor(() => expect(sendPrompt).toHaveBeenCalled());
    rejectDelivery({
      success: false,
      error: { type: 'invalid_state', message: 'session unavailable' },
    });

    await vi.waitFor(() => expect(setPendingPrompt).toHaveBeenLastCalledWith(null));
    expect(store.draftText).toBe('newer draft');
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

  it('clears draft text and attachments on submit', async () => {
    const sendPrompt = vi.fn(async () => ({ success: true, data: { queued: false } }));
    const store = createStore(idleState(), sendPrompt);
    const attachment = promptAttachment('attachment-submit', 'data:image/png;base64,AQ==');
    store.setDraftText('hello');
    store.addDraftAttachments([attachment]);

    store.submitPrompt(store.draftText, store.draftAttachments);

    expect(store.draftText).toBe('');
    expect(store.draftAttachments).toEqual([]);
    await vi.waitFor(() =>
      expect(sendPrompt).toHaveBeenCalledWith({
        text: 'hello',
        attachments: [attachment.ref],
      })
    );
  });

  it('deletes attachment bytes when a draft attachment is removed', async () => {
    conversationClientTestState.deleteAttachment.mockResolvedValue({
      success: true,
      data: undefined,
    });
    const store = createStore(idleState(), vi.fn());
    store.addDraftAttachments([
      promptAttachment('attachment-remove', 'data:image/png;base64,AQ=='),
    ]);

    store.removeDraftAttachment('attachment-remove');

    expect(store.draftAttachments).toEqual([]);
    await vi.waitFor(() =>
      expect(conversationClientTestState.deleteAttachment).toHaveBeenCalledWith({
        conversationId: 'conversation-1',
        attachmentId: 'attachment-remove',
      })
    );
  });

  it('deletes attachment bytes before the live session connects', async () => {
    conversationClientTestState.deleteAttachment.mockResolvedValue({
      success: true,
      data: undefined,
    });
    const store = new AcpChatStore('conversation-1', 'project-1', 'task-1');
    store.addDraftAttachments([
      promptAttachment('attachment-pre-bootstrap', 'data:image/png;base64,AQ=='),
    ]);

    store.removeDraftAttachment('attachment-pre-bootstrap');

    expect(store.session).toBeNull();
    await vi.waitFor(() =>
      expect(conversationClientTestState.deleteAttachment).toHaveBeenCalledWith({
        conversationId: 'conversation-1',
        attachmentId: 'attachment-pre-bootstrap',
      })
    );
  });

  it('persists attachment refs without preview bytes', () => {
    const store = createStore(idleState(), vi.fn());
    store.setDraftText('persist me');
    store.addDraftAttachments([
      promptAttachment('attachment-persist', 'data:image/png;base64,AQ=='),
    ]);

    expect(mementoTestState.producer?.()).toEqual({
      version: '1',
      text: 'persist me',
      attachments: [
        {
          id: 'attachment-persist',
          mimeType: 'image/png',
          name: 'attachment-persist.png',
        },
      ],
    });
  });

  it('does not overwrite local input when memento hydration finishes late', async () => {
    let resolveMemento!: () => void;
    mementoTestState.value = {
      version: '1',
      text: 'stored text',
      attachments: [{ id: 'stored-attachment', mimeType: 'image/png' }],
    };
    mementoTestState.ready = new Promise<void>((resolve) => {
      resolveMemento = resolve;
    });
    const store = createStore(idleState(), vi.fn());
    store.setDraftText('local text');

    resolveMemento();
    await mementoTestState.ready;
    await Promise.resolve();

    expect(store.draftText).toBe('local text');
    expect(store.draftAttachments).toEqual([]);
  });

  it('prunes restored attachment refs when attachment bytes are missing', async () => {
    mementoTestState.value = {
      version: '1',
      text: '',
      attachments: [{ id: 'attachment-missing', mimeType: 'image/png', name: 'missing.png' }],
    };
    conversationClientTestState.downloadAttachment.mockResolvedValue({
      success: false as const,
      error: { type: 'attachment_not_found' as const },
    });

    const store = createStore(idleState(), vi.fn());

    await vi.waitFor(() =>
      expect(conversationClientTestState.downloadAttachment).toHaveBeenCalledWith({
        conversationId: 'conversation-1',
        attachmentId: 'attachment-missing',
      })
    );
    await vi.waitFor(() => expect(store.draftAttachments).toEqual([]));
  });

  it('keeps restored refs after transient failures and retries after remount', async () => {
    mementoTestState.value = {
      version: '1',
      text: '',
      attachments: [
        {
          id: 'attachment-transient',
          mimeType: 'image/png',
          name: 'attachment-transient.png',
        },
      ],
    };
    conversationClientTestState.downloadAttachment
      .mockResolvedValueOnce({
        success: false as const,
        error: { type: 'invalid_state' as const, message: 'worker unavailable' },
      })
      .mockResolvedValueOnce({
        success: true as const,
        data: {
          meta: {
            id: 'attachment-transient',
            mimeType: 'image/png' as const,
            name: 'attachment-transient.png',
          },
          bytes: async () => new Uint8Array([1]),
        },
      });
    const firstStore = createStore(idleState(), vi.fn());

    await vi.waitFor(() =>
      expect(conversationClientTestState.downloadAttachment).toHaveBeenCalledTimes(1)
    );
    expect(firstStore.draftAttachments).toEqual([promptAttachment('attachment-transient')]);
    firstStore.dispose();

    const secondStore = createStore(idleState(), vi.fn());

    await vi.waitFor(() =>
      expect(secondStore.draftAttachments).toEqual([
        promptAttachment('attachment-transient', 'data:image/png;base64,AQ=='),
      ])
    );
  });

  it('rehydrates restored attachment previews without waiting for the live session', async () => {
    mementoTestState.value = {
      version: '1',
      text: '',
      attachments: [{ id: 'attachment-preview', mimeType: 'image/png', name: 'preview.png' }],
    };
    conversationClientTestState.downloadAttachment.mockResolvedValue({
      success: true as const,
      data: {
        meta: { id: 'attachment-preview', mimeType: 'image/png' as const, name: 'preview.png' },
        bytes: async () => new Uint8Array([1]),
      },
    });

    const store = createStore(idleState(), vi.fn());

    await vi.waitFor(() =>
      expect(store.draftAttachments).toEqual([
        expect.objectContaining({ previewUrl: 'data:image/png;base64,AQ==' }),
      ])
    );
  });

  it('keeps the composer enabled and an optimistic prompt visible while suspended', async () => {
    let finishPrompt!: () => void;
    const sendPrompt = vi.fn(
      () =>
        new Promise<{ success: true; data: { queued: false } }>((resolve) => {
          finishPrompt = () => resolve({ success: true, data: { queued: false } });
        })
    );
    const live = fakeLiveSession(suspendedState(), unavailableHistory(), { sendPrompt });
    const store = await bootstrapWithSession(live.session);

    expect(store.affordances).toMatchObject({
      isWorking: false,
      isBusy: false,
      isResuming: false,
      canSubmit: true,
    });

    store.submitPrompt('wake up');
    await vi.waitFor(() => expect(sendPrompt).toHaveBeenCalled());
    expect(chatSessionTestState.pendingPrompt).toMatchObject({ text: 'wake up' });

    live.loadHistory.mockClear();
    connectSessionOptions?.onTurnCommitted?.();
    await vi.waitFor(() => expect(live.loadHistory).toHaveBeenCalledTimes(1));
    expect(chatSessionTestState.pendingPrompt).toMatchObject({ text: 'wake up' });

    finishPrompt();
    store.dispose();
  });

  it('keeps the attached composer available when background activation fails', async () => {
    const loadHistory = vi.fn(async () => ({
      success: false as const,
      error: { type: 'initialize_failed' as const, cause: { message: 'restore failed' } },
    }));
    const live = fakeLiveSession(suspendedState(), unavailableHistory(), {
      loadHistory,
    });

    const store = await bootstrapWithSession(live.session);

    expect(store.session).toBe(live.session);
    expect(store.loadError).not.toBeNull();
    expect(store.affordances).toMatchObject({ isBusy: false, canSubmit: true });
    expect(loadHistory).toHaveBeenCalledTimes(1);
    store.dispose();
  });

  it('does not remember a rejected provider change as a future default', async () => {
    const setOption = vi.fn(async () => ({
      success: false as const,
      error: { type: 'set_mode_failed' as const, cause: { message: 'rejected' } },
    }));
    const store = createStore(idleState(), vi.fn(), { setOption });
    const rememberPreference = vi
      .spyOn(
        store as unknown as {
          _rememberPreference(patch: { modeId: string }): Promise<void>;
        },
        '_rememberPreference'
      )
      .mockResolvedValue();

    store.setMode('agent-full-access');

    await vi.waitFor(() => expect(setOption).toHaveBeenCalledWith('mode', 'agent-full-access'));
    expect(rememberPreference).not.toHaveBeenCalled();
    store.dispose();
  });

  it('keeps the ordinary active-turn completion history refresh', async () => {
    const live = fakeLiveSession(idleState(), historyPage('initial'));
    const store = await bootstrapWithSession(live.session);
    live.loadHistory.mockClear();
    historySeed.mockClear();
    live.loadHistory.mockResolvedValueOnce({ success: true, data: historyPage('completed') });

    connectSessionOptions?.onTurnCommitted?.();

    await vi.waitFor(() => expect(live.loadHistory).toHaveBeenCalledTimes(1));
    expect(historySeed).toHaveBeenCalledTimes(1);
    expect(historySeed).toHaveBeenCalledWith([expect.objectContaining({ id: 'completed' })]);
    store.dispose();
  });

  it('refreshes authoritative history when Host availability returns', async () => {
    const hostState = observable.box<ProjectHostAccessState>({
      kind: 'ready',
      hostGeneration: 1,
    });
    const hostAccess = {
      get state() {
        return hostState.get();
      },
      get liveAction() {
        const state = hostState.get();
        return state.kind === 'ready'
          ? ({ kind: 'enabled' } as const)
          : ({ kind: 'disabled', state } as const);
      },
    } as ProjectHostAccess;
    const live = fakeLiveSession(idleState(), historyPage('before'));
    vi.spyOn(AcpLiveSession, 'create').mockResolvedValueOnce(live.session);
    const store = new AcpChatStore('conversation-1', 'project-1', 'task-1', hostAccess);
    store.bootstrap();
    await vi.waitFor(() => expect(store.historyLoading).toBe(false));
    live.loadHistory.mockClear();
    historySeed.mockClear();
    live.loadHistory.mockResolvedValueOnce({ success: true, data: historyPage('recovered') });

    runInAction(() =>
      hostState.set({ kind: 'degraded', situation: 'offline', recovery: 'automatic' })
    );
    runInAction(() => hostState.set({ kind: 'ready', hostGeneration: 2 }));

    await vi.waitFor(() => expect(live.loadHistory).toHaveBeenCalledTimes(1));
    expect(historySeed).toHaveBeenCalledWith([expect.objectContaining({ id: 'recovered' })]);
    store.dispose();
  });

  it('keeps rendered history when a suspension-driven refresh is unavailable', async () => {
    const live = fakeLiveSession(idleState(), historyPage('rendered'));
    const store = await bootstrapWithSession(live.session);
    live.loadHistory.mockClear();
    historySeed.mockClear();
    live.loadHistory.mockResolvedValueOnce({ success: true, data: unavailableHistory() });

    connectSessionOptions?.onTurnCommitted?.();

    await vi.waitFor(() => expect(live.loadHistory).toHaveBeenCalledTimes(1));
    expect(historySeed).not.toHaveBeenCalled();
    expect(transcriptTestState.committedTurns).toEqual([
      expect.objectContaining({ id: 'rendered' }),
    ]);
    store.dispose();
  });

  it('coalesces replay completion into one refresh without dropping the pending prompt', async () => {
    const live = fakeLiveSession(suspendedState(), historyPage('rendered'));
    const store = await bootstrapWithSession(live.session);
    live.loadHistory.mockClear();
    historySeed.mockClear();
    historySeed.mockImplementation((turns) => {
      transcriptTestState.committedTurns = turns;
      setPendingPrompt(null);
    });
    live.loadHistory.mockResolvedValue({ success: true, data: historyPage('replayed') });
    setPendingPrompt({ id: 'optimistic-1', text: 'continue' });

    live.sessionState.set({ ...idleState(), lifecycle: 'replaying', canSubmit: true });
    expect(store.affordances).toMatchObject({
      isWorking: false,
      isBusy: false,
      isResuming: true,
      canSubmit: true,
    });
    live.sessionState.set(idleState());
    live.sessionState.set(idleState());

    await vi.waitFor(() => expect(live.loadHistory).toHaveBeenCalledTimes(1));
    expect(historySeed).toHaveBeenCalledTimes(1);
    expect(historySeed).toHaveBeenCalledWith([expect.objectContaining({ id: 'replayed' })]);
    expect(chatSessionTestState.pendingPrompt).toEqual({
      id: 'optimistic-1',
      text: 'continue',
    });
    store.dispose();
  });

  it('does not replace a prompt turn that starts while replay history is loading', async () => {
    let finishHistory!: (result: { success: true; data: HistoryPage }) => void;
    const live = fakeLiveSession(suspendedState(), historyPage('rendered'));
    const store = await bootstrapWithSession(live.session);
    live.loadHistory.mockClear();
    historySeed.mockClear();
    live.loadHistory.mockImplementationOnce(
      () =>
        new Promise<{ success: true; data: HistoryPage }>((resolve) => {
          finishHistory = resolve;
        })
    );

    live.sessionState.set({ ...idleState(), lifecycle: 'replaying', canSubmit: true });
    live.sessionState.set(idleState());
    await vi.waitFor(() => expect(live.loadHistory).toHaveBeenCalledTimes(1));
    transcriptTestState.activeTurnSnapshot = historyPage('active').turns[0];
    finishHistory({ success: true, data: historyPage('replayed') });
    await Promise.resolve();

    expect(historySeed).not.toHaveBeenCalled();
    expect(transcriptTestState.activeTurnSnapshot?.id).toBe('active');
    store.dispose();
  });
});

class FakeRemote<T> {
  private readonly listeners = new Set<(value: T) => void>();

  constructor(private value: T) {}

  current(): T {
    return this.value;
  }

  onChange(listener: (value: T) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  set(value: T): void {
    this.value = value;
    for (const listener of this.listeners) listener(value);
  }
}

function fakeLiveSession(
  state: SessionState,
  initialHistory: HistoryPage,
  overrides: Record<string, unknown> = {}
) {
  const sessionState = new FakeRemote(state);
  const loadHistory = vi.fn(async () => ({ success: true as const, data: initialHistory }));
  const session = {
    sessionState,
    config: new FakeRemote({ availableCommands: [] }),
    usage: new FakeRemote(null),
    plan: new FakeRemote(null),
    activeTurn: new FakeRemote(null),
    terminals: new FakeRemote([]),
    mcpServers: new FakeRemote([]),
    loadHistory,
    terminalOutput: vi.fn(),
    sendPrompt: vi.fn(async () => ({ success: true, data: { queued: false } })),
    dispose: vi.fn(),
    ...overrides,
  } as unknown as AcpLiveSession;
  return { session, sessionState, loadHistory };
}

async function bootstrapWithSession(session: AcpLiveSession): Promise<AcpChatStore> {
  vi.spyOn(AcpLiveSession, 'create').mockResolvedValueOnce(session);
  const store = new AcpChatStore('conversation-1', 'project-1', 'task-1');
  store.bootstrap();
  await vi.waitFor(() => expect(store.historyLoading).toBe(false));
  return store;
}

function historyPage(turnId: string): HistoryPage {
  return {
    turns: [{ id: turnId, seq: 0, initiator: 'user', items: [] }],
    nextCursor: null,
  };
}

function historyPageWithPrompt(turnId: string, seq: number, text: string): HistoryPage {
  return {
    turns: [
      {
        id: turnId,
        seq,
        initiator: 'user',
        items: [{ kind: 'message', id: `${turnId}-user`, seq: 0, role: 'user', text }],
      },
    ],
    nextCursor: null,
  };
}

function unavailableHistory(): HistoryPage {
  return { turns: [], nextCursor: null, unavailable: true };
}

function createStore(
  state: SessionState,
  sendPrompt: ReturnType<typeof vi.fn>,
  sessionOverrides: Record<string, unknown> = {}
) {
  const store = new AcpChatStore('conversation-1', 'project-1', 'task-1');
  store.session = {
    sessionState: { current: () => state },
    sendPrompt,
    loadHistory: vi.fn(async () => ({ success: true, data: unavailableHistory() })),
    dispose: vi.fn(),
    ...sessionOverrides,
  } as never;
  return store;
}

function promptAttachment(id: string, previewUrl?: string): AcpPromptAttachment {
  return {
    ref: { type: 'attachment', id, mimeType: 'image/png', name: `${id}.png` },
    previewUrl,
  };
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

function suspendedState(): SessionState {
  return {
    ...idleState(),
    lifecycle: 'closed',
    suspended: true,
  };
}
