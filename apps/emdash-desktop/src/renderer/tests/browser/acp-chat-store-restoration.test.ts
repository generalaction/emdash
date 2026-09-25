import * as chatUi from '@emdash/chat-ui';
import type {
  HistoryPage,
  SessionState,
  TranscriptTurn,
} from '@emdash/core/runtimes/acp/api/client';
import { ok } from '@emdash/shared';
import { deferred } from '@emdash/shared/testing';
import { observable, runInAction } from 'mobx';
import { expect, it, vi } from 'vitest';
import { installChatUiRuntime } from '@core/features/conversations/api/browser/chat/chat-ui-runtime';
import { AcpChatStore } from '@core/features/conversations/browser/acp/acp-chat-store';
import { AcpLiveSession } from '@core/features/conversations/browser/acp/acp-live-session';
import type { ProjectHostAccessState } from '@core/features/projects/api/browser/stores/project-context';

const fixture = vi.hoisted(() => ({ context: undefined as unknown }));
vi.mock('@core/features/conversations/api/browser/chat/shared-chat-context', () => ({
  getSharedChatContext: () => fixture.context,
}));
vi.mock('@core/primitives/mementos/browser', () => ({
  getMementoClient: () => ({
    reportError: vi.fn(),
    subject: () => ({
      ready: Promise.resolve(),
      release: async () => {},
      handle: () => ({
        value: { version: '1', text: '', attachments: [] },
        autoPersist: () => () => {},
      }),
    }),
  }),
}));

function remote<T>(initial: T) {
  let value = initial;
  const listeners = new Set<(value: T) => void>();
  return {
    current: () => value,
    onChange(listener: (value: T) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next: T) {
      value = next;
      for (const listener of listeners) listener(value);
    },
  };
}

const previous: TranscriptTurn = {
  id: 'previous',
  seq: 0,
  initiator: 'agent',
  items: [
    { kind: 'message', id: 'previous-message', seq: 0, role: 'assistant', text: 'Previous answer' },
  ],
};
const current: TranscriptTurn = {
  id: 'current',
  seq: 1,
  initiator: 'user',
  items: [
    {
      kind: 'message',
      id: 'current-message',
      seq: 0,
      role: 'user',
      text: 'Latest prompt',
      promptId: 'latest',
    },
  ],
};

it.each(['live', 'submitted', 'disposed', 'unavailable', 'reattached'] as const)(
  'installs bootstrap history without losing newer state: %s',
  async (mode) => {
    installChatUiRuntime(chatUi);
    const context = chatUi.createChatContext();
    fixture.context = context;
    const history = deferred<HistoryPage>();
    const activeTurn = remote<TranscriptTurn | null>(mode === 'live' ? current : null);
    const state: SessionState = {
      lifecycle: 'ready',
      activeTurnId: mode === 'live' ? current.id : null,
      pendingPermissions: [],
      lastStopReason: null,
      lastTurnErrored: false,
      queuedPrompts: [],
      agentTurnActive: mode === 'live',
      backgroundAgentCount: 0,
      isGenerating: mode === 'live',
      canSubmit: true,
      canCancel: mode === 'live',
    };
    const live = {
      activeTurn,
      sessionState: remote(state),
      plan: remote(null),
      config: remote({
        modelOptions: null,
        efforts: null,
        modeOptions: null,
        availableCommands: [],
      }),
      usage: remote(null),
      terminals: remote([]),
      mcpServers: remote([]),
      startSession: vi.fn(async () => ok({ sessionId: 'session-1' })),
      loadHistory: vi.fn(async () => ok(await history.promise)),
      sendPrompt: vi.fn(async () => ok({ queued: false })),
      usable: true,
      revalidate: vi.fn(async () => {}),
      dispose: vi.fn(),
    };
    const create = vi
      .spyOn(AcpLiveSession, 'create')
      .mockResolvedValue(live as unknown as AcpLiveSession);
    const hostState = observable.box<ProjectHostAccessState>({ kind: 'ready', hostGeneration: 1 });
    const store = new AcpChatStore('conversation-restore', 'project-restore', 'task-restore', {
      get state() {
        return hostState.get();
      },
      liveAction: { kind: 'enabled' },
    } as never);
    const parent = document.createElement('div');
    parent.style.cssText = 'position:fixed;top:0;left:0;width:800px;height:600px';
    document.body.append(parent);
    const view = chatUi.createChatView({ context, state: store.chatState, parent });
    let disposed = false;
    try {
      store.bootstrap();
      await vi.waitFor(() => expect(live.loadHistory).toHaveBeenCalledOnce());
      if (mode === 'live') {
        await vi.waitFor(() =>
          expect(parent.querySelector('[data-user-card="current-message"]')).not.toBeNull()
        );
      }
      if (mode === 'submitted') store.submitPrompt('Latest prompt');
      const replacement = { ...previous, id: 'replacement-history' };
      if (mode === 'reattached') {
        const nextLive = {
          ...live,
          loadHistory: vi.fn(async () => ok({ turns: [replacement], nextCursor: null })),
        };
        create.mockResolvedValueOnce(nextLive as unknown as AcpLiveSession);
        runInAction(() => hostState.set({ kind: 'ready', hostGeneration: 2 }));
        await vi.waitFor(() =>
          expect(store.chatState.transcript.state.committedTurns).toEqual([replacement])
        );
      }
      if (mode === 'disposed') {
        view.dispose();
        store.dispose();
        disposed = true;
      }
      history.resolve({
        turns: mode === 'unavailable' ? [] : [previous],
        nextCursor: null,
        ...(mode === 'unavailable' && { unavailable: true }),
      });
      await vi.waitFor(() => expect(live.loadHistory).toHaveResolvedTimes(1));
      if (mode === 'disposed') {
        expect(store.chatState.transcript.state.committedTurns).toEqual([]);
      } else if (mode === 'reattached') {
        expect(store.chatState.transcript.state.committedTurns).toEqual([replacement]);
      } else if (mode === 'unavailable') {
        expect(store.historyKnown).toBe(false);
        expect(store.loadError).not.toBeNull();
      } else {
        await vi.waitFor(() => expect(store.historyLoading).toBe(false));
        expect(store.chatState.transcript.state.committedTurns).toEqual([previous]);
        if (mode === 'live') {
          expect(store.chatState.transcript.state.activeTurnSnapshot?.id).toBe(current.id);
          expect(parent.querySelector('[data-user-card="current-message"]')).not.toBeNull();
        } else {
          expect(store.chatState.session.state.pendingPrompt?.text).toBe('Latest prompt');
        }
      }
    } finally {
      history.resolve({ turns: [], nextCursor: null });
      if (!disposed) {
        view.dispose();
        store.dispose();
      }
      context.dispose();
      parent.remove();
      create.mockRestore();
    }
  }
);
