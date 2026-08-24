import type { SessionState } from '@emdash/core/runtimes/acp/api/client';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChatUiRuntime } from '@core/features/conversations/api/browser/chat/chat-ui-runtime';
import {
  AcpChatStore,
  type AcpPromptAttachment,
} from '@core/features/conversations/browser/acp/acp-chat-store';

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

vi.mock('@core/features/conversations/api/browser/chat/shared-chat-context', () => ({
  getSharedChatContext: () => ({}),
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
    mementoTestState.value = { version: '1', text: '', attachments: [] };
    mementoTestState.producer = null;
    mementoTestState.ready = Promise.resolve();
    mementoTestState.reportError.mockClear();
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
    const deleteAttachment = vi.fn(async () => ({ success: true, data: undefined }));
    const store = createStore(idleState(), vi.fn(), { deleteAttachment });
    store.addDraftAttachments([
      promptAttachment('attachment-remove', 'data:image/png;base64,AQ=='),
    ]);

    store.removeDraftAttachment('attachment-remove');

    expect(store.draftAttachments).toEqual([]);
    await vi.waitFor(() => expect(deleteAttachment).toHaveBeenCalledWith('attachment-remove'));
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

  it('prunes restored attachment refs when preview download fails', async () => {
    mementoTestState.value = {
      version: '1',
      text: '',
      attachments: [{ id: 'attachment-missing', mimeType: 'image/png', name: 'missing.png' }],
    };
    const downloadAttachment = vi.fn(async () => ({
      success: false as const,
      error: { type: 'invalid_state' as const },
    }));

    const store = createStore(idleState(), vi.fn(), { downloadAttachment });

    await vi.waitFor(() => expect(downloadAttachment).toHaveBeenCalledWith('attachment-missing'));
    await vi.waitFor(() => expect(store.draftAttachments).toEqual([]));
  });

  it('rehydrates restored attachment previews after the session connects', async () => {
    mementoTestState.value = {
      version: '1',
      text: '',
      attachments: [{ id: 'attachment-preview', mimeType: 'image/png', name: 'preview.png' }],
    };
    const downloadAttachment = vi.fn(async () => ({
      success: true as const,
      data: {
        ref: { id: 'attachment-preview', mimeType: 'image/png' as const, name: 'preview.png' },
        data: new Uint8Array([1]),
      },
    }));

    const store = createStore(idleState(), vi.fn(), { downloadAttachment });

    await vi.waitFor(() =>
      expect(store.draftAttachments).toEqual([
        expect.objectContaining({ previewUrl: 'data:image/png;base64,AQ==' }),
      ])
    );
  });
});

function createStore(
  state: SessionState,
  sendPrompt: ReturnType<typeof vi.fn>,
  sessionOverrides: Record<string, unknown> = {}
) {
  const store = new AcpChatStore('conversation-1', 'project-1', 'task-1');
  store.session = {
    sessionState: { current: () => state },
    sendPrompt,
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
