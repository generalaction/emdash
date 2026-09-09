import type { HistoryPage, SessionState } from '@emdash/core/runtimes/acp/api/client';
import { deferred } from '@emdash/shared/testing';
import { toast } from '@emdash/ui/react/primitives';
import {
  client,
  connect,
  createController,
  createWireSessionHub,
  defineContract,
  memoryTransportPair,
} from '@emdash/wire/rpc';
import { observable, runInAction } from 'mobx';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { conversationsContract } from '@core/features/conversations/api';
import { installChatUiRuntime } from '@core/features/conversations/api/browser/chat/chat-ui-runtime';
import {
  AcpChatStore,
  type AcpPromptAttachment,
} from '@core/features/conversations/browser/acp/acp-chat-store';
import {
  AcpLiveSession,
  AcpPromptDeliveryUnknownError,
} from '@core/features/conversations/browser/acp/acp-live-session';
import type { ProjectHostAccessState } from '@core/features/projects/api/browser/stores/project-context';

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
  it.each(['disconnected', 'disposed', 'buffer-full'] as const)(
    'restores the draft and clears the optimistic prompt after a %s pre-delivery failure',
    async (reason) => {
      const pair = memoryTransportPair();
      const post = vi.fn(pair.left.post);
      const connection = connect(
        {
          ...pair.left,
          post,
          ...(reason === 'buffer-full' ? { onReconnect: () => () => {} } : {}),
        },
        { maxHeldCalls: 0 }
      );
      if (reason === 'disposed') connection.dispose();
      else pair.disconnect();
      const acp = client(
        defineContract({ sendPrompt: conversationsContract.acp.sendPrompt }),
        connection
      );
      const sendPrompt = vi.fn((prompt) =>
        AcpLiveSession.prototype.sendPrompt.call(
          { client: acp, conversationId: 'conversation-1' } as never,
          prompt
        )
      );
      const store = createStore(idleState(), sendPrompt);
      const errorToast = vi.spyOn(toast, 'error');
      try {
        store.setDraftText('keep this prompt');
        store.submitPrompt('keep this prompt');
        await vi.waitFor(() => expect(errorToast).toHaveBeenCalledOnce());
        expect(store.draftText).toBe('keep this prompt');
        expect(chatSessionTestState.pendingPrompt).toBeNull();
        expect(store.unconfirmedPromptIds).toEqual([]);
        expect(sendPrompt).toHaveBeenCalledOnce();
        if (reason !== 'disconnected') expect(post).not.toHaveBeenCalled();
      } finally {
        store.dispose();
        connection.dispose();
        errorToast.mockRestore();
      }
    }
  );

  it.each(['host-check', 'timer', 'retry'] as const)(
    'recovers a timed-out attachment through %s without a new host generation',
    async (trigger) => {
      const hostState = observable.box<ProjectHostAccessState>({
        kind: 'ready',
        hostGeneration: 1,
      });
      const host = {
        get state() {
          return hostState.get();
        },
        get liveAction() {
          return hostState.get().kind === 'ready'
            ? { kind: 'enabled' }
            : { kind: 'disabled', state: hostState.get() };
        },
      };
      const usable = observable.box(true);
      const revalidate = vi.fn<() => Promise<void>>(async () => {
        runInAction(() => usable.set(false));
        throw new Error('Timed out reattaching ACP session');
      });
      const store = new AcpChatStore('conversation-1', 'project-1', 'task-1', host as never);
      store.session = {
        sessionState: { current: idleState },
        get usable() {
          return usable.get();
        },
        revalidate,
        dispose: vi.fn(),
      } as never;
      try {
        runInAction(() => hostState.set({ kind: 'ready', hostGeneration: 2 }));
        await vi.waitFor(() =>
          expect(store.loadError?.message).toBe('Timed out reattaching ACP session')
        );
        expect(store.affordances.canSubmit).toBe(false);
        revalidate.mockImplementation(async () => {
          runInAction(() => usable.set(true));
        });
        if (trigger === 'host-check') {
          runInAction(() =>
            hostState.set({ kind: 'degraded', situation: 'checking', recovery: 'automatic' })
          );
          runInAction(() => hostState.set({ kind: 'ready', hostGeneration: 2 }));
        } else if (trigger === 'retry') {
          store.retry();
        }
        await vi.waitFor(() => expect(store.affordances.canSubmit).toBe(true), { timeout: 3_000 });
        expect(revalidate).toHaveBeenCalledTimes(2);
        expect(store.loadError).toBeNull();
      } finally {
        store.dispose();
      }
    }
  );

  it.each(['active', 'queued', 'history', 'unrelated'] as const)(
    'reconciles a lost acknowledgement using %s state without restoring the draft',
    async (source) => {
      const promptId = crypto.randomUUID();
      const sendPrompt = vi
        .fn()
        .mockRejectedValue(new AcpPromptDeliveryUnknownError(promptId, new Error('disconnected')));
      const activeTurn = new FakeRemote<HistoryPage['turns'][number] | null>(null);
      const live = fakeLiveSession(
        idleState(),
        { turns: [], nextCursor: null },
        { sendPrompt, activeTurn }
      );
      const store = await bootstrapWithSession(live.session);
      const errorToast = vi.spyOn(toast, 'error');
      try {
        store.submitPrompt('continue');
        await vi.waitFor(() => expect(store.unconfirmedPromptIds).toEqual([promptId]));
        expect(store.draftText).toBe('');
        expect(errorToast).not.toHaveBeenCalled();
        store.setDraftText('a new draft');
        const turn: HistoryPage['turns'][number] = {
          id: 'turn',
          seq: 0,
          initiator: 'user',
          items: [
            {
              kind: 'message',
              id: 'message',
              seq: 0,
              role: 'user',
              text: 'continue',
              promptId: source === 'unrelated' ? crypto.randomUUID() : promptId,
            },
          ],
        };
        if (source === 'queued') {
          live.sessionState.set({
            ...idleState(),
            queuedPrompts: [{ id: promptId, text: 'continue', createdAt: 0, updatedAt: 0 }],
          });
        } else if (source === 'history') {
          live.loadHistory.mockResolvedValue({
            success: true,
            data: { turns: [turn], nextCursor: null },
          });
          connectSessionOptions?.onTurnCommitted?.();
        } else {
          activeTurn.set(turn);
        }
        await vi.waitFor(() =>
          expect(store.unconfirmedPromptIds).toEqual(source === 'unrelated' ? [promptId] : [])
        );
        expect(store.draftText).toBe('a new draft');
        expect(sendPrompt).toHaveBeenCalledOnce();
      } finally {
        store.dispose();
        errorToast.mockRestore();
      }
    }
  );

  it('routes retry to host recovery while access is disabled', () => {
    const recover = vi.fn(async () => ({ success: true }));
    const store = new AcpChatStore('conversation-1', 'project-1', 'task-1', {
      state: { kind: 'degraded', situation: 'recovering', recovery: 'automatic' },
      liveAction: { kind: 'disabled' },
      recover,
    } as never);
    try {
      store.retry();
      expect(recover).toHaveBeenCalledOnce();
      expect(store.session).toBeNull();
    } finally {
      store.dispose();
    }
  });

  it('keeps drafting local while rejecting remote actions on an unusable session', () => {
    const remoteAction = vi.fn();
    const store = createStore(idleState(), remoteAction, {
      usable: false,
      setOption: remoteAction,
      cancelTurn: remoteAction,
      deleteQueuedPrompt: remoteAction,
      changeQueuePromptOrder: remoteAction,
    });
    try {
      store.setDraftText('keep writing offline');
      store.setModel('model');
      store.setMode('mode');
      store.setEffort('high');
      store.setCollaborationMode('plan');
      store.stop();
      store.deleteQueuedPrompt('queued');
      store.reorderQueuedPrompts(['queued']);
      expect(remoteAction).not.toHaveBeenCalled();
      expect(store.draftText).toBe('keep writing offline');
      expect(store.affordances.canSubmit).toBe(false);
    } finally {
      store.dispose();
    }
  });

  it('does not report send failure or restore a remotely accepted prompt when the Wire reply is lost', async () => {
    const gate = deferred<void>();
    const received: string[] = [];
    const contract = defineContract({ sendPrompt: conversationsContract.acp.sendPrompt });
    const hub = createWireSessionHub(
      createController(
        contract,
        {
          sendPrompt: async ({ prompt, promptId }) => {
            received.push(prompt.text);
            transcriptTestState.activeTurnSnapshot = {
              id: 'remote-turn',
              seq: 0,
              initiator: 'user',
              items: [
                { kind: 'message', id: 'user', seq: 0, role: 'user', text: prompt.text, promptId },
              ],
            };
            await gate.promise;
            return { success: true as const, data: { queued: false } };
          },
        },
        { validate: 'full' }
      )
    );
    const pair = memoryTransportPair();
    hub.open('desktop', pair.right);
    const connection = connect(pair.left);
    const acp = client(contract, connection);
    const sendPrompt = vi.fn((prompt) =>
      AcpLiveSession.prototype.sendPrompt.call(
        { client: acp, conversationId: 'conversation-1' } as never,
        prompt
      )
    );
    const store = createStore(idleState(), sendPrompt, {
      activeTurn: { current: () => transcriptTestState.activeTurnSnapshot },
    });
    const errorToast = vi.spyOn(toast, 'error');
    try {
      store.submitPrompt('continue');
      await vi.waitFor(() => expect(received).toEqual(['continue']));
      pair.disconnect();
      await vi.waitFor(() =>
        expect(sendPrompt.mock.results[0]?.value).rejects.toBeInstanceOf(
          AcpPromptDeliveryUnknownError
        )
      );
      await Promise.resolve();
      expect(store.draftText).toBe('');
      expect(store.unconfirmedPromptIds).toEqual([]);
      expect(errorToast).not.toHaveBeenCalled();
      expect(received).toEqual(['continue']);
    } finally {
      gate.resolve();
      store.dispose();
      connection.dispose();
      await hub.dispose();
      errorToast.mockRestore();
    }
  });

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
      expect(sendPrompt).toHaveBeenCalledWith(
        {
          text: 'hello',
          hiddenContext: 'resolved context',
        },
        undefined,
        expect.any(String)
      )
    );
  });

  it('still sends the prompt when optional issue context fails to resolve', async () => {
    const sendPrompt = vi.fn(async () => ({ success: true, data: { queued: false } }));
    const store = createStore(idleState(), sendPrompt);
    store.setDraftText('hello');

    store.submitPrompt('hello', [], Promise.reject(new Error('context unavailable')));

    await vi.waitFor(() =>
      expect(sendPrompt).toHaveBeenCalledWith({ text: 'hello' }, undefined, expect.any(String))
    );
    expect(store.draftText).toBe('');
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
      expect(sendPrompt).toHaveBeenCalledWith(
        {
          text: 'hello',
          attachments: [attachment.ref],
        },
        undefined,
        expect.any(String)
      )
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

  it('remembers a successful collaboration-mode change', async () => {
    const setOption = vi.fn(async () => ({ success: true as const, data: undefined }));
    const store = createStore(idleState(), vi.fn(), { setOption });
    const rememberPreference = vi
      .spyOn(
        store as unknown as {
          _rememberPreference(patch: { collaborationMode: string }): Promise<void>;
        },
        '_rememberPreference'
      )
      .mockResolvedValue();

    store.setCollaborationMode('plan');

    await vi.waitFor(() => expect(setOption).toHaveBeenCalledWith('collaborationMode', 'plan'));
    expect(rememberPreference).toHaveBeenCalledWith({ collaborationMode: 'plan' });
    store.dispose();
  });

  it.each(['retry', 'host-recovery'] as const)(
    'reloads failed bootstrap history through %s even with a retained session',
    async (trigger) => {
      const hostState = observable.box<ProjectHostAccessState>({
        kind: 'ready',
        hostGeneration: 1,
      });
      const failed = fakeLiveSession(idleState(), historyPage('initial'), {
        revalidate: vi.fn(async () => {}),
      });
      failed.loadHistory.mockRejectedValueOnce(new Error('History unavailable'));
      const recovered = fakeLiveSession(idleState(), historyPage('recovered'));
      const create = vi
        .spyOn(AcpLiveSession, 'create')
        .mockResolvedValueOnce(failed.session)
        .mockResolvedValueOnce(recovered.session);
      const store = new AcpChatStore('conversation-1', 'project-1', 'task-1', {
        get state() {
          return hostState.get();
        },
        liveAction: { kind: 'enabled' },
      } as never);
      try {
        store.bootstrap();
        await vi.waitFor(() => expect(store.historyLoading).toBe(false));
        expect(store.session).toBe(failed.session);
        expect(store.loadError?.message).toBe('History unavailable');
        expect(historySeed).not.toHaveBeenCalled();

        if (trigger === 'retry') store.retry();
        else runInAction(() => hostState.set({ kind: 'ready', hostGeneration: 2 }));

        await vi.waitFor(() =>
          expect(historySeed).toHaveBeenCalledWith([expect.objectContaining({ id: 'recovered' })])
        );
        expect(failed.session.dispose).toHaveBeenCalledOnce();
        expect(recovered.loadHistory).toHaveBeenCalledWith(undefined, 100);
        expect(store.historyLoading).toBe(false);
        expect(store.loadError).toBeNull();
      } finally {
        store.dispose();
        create.mockRestore();
      }
    }
  );

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
    usable: true,
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
    usable: true,
    sessionState: { current: () => state },
    sendPrompt,
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
