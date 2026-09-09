import * as chatUi from '@emdash/chat-ui';
import type { HistoryPage, SessionState } from '@emdash/core/runtimes/acp/api/client';
import { ok } from '@emdash/shared';
import { deferred } from '@emdash/shared/testing';
import {
  client,
  connect,
  createController,
  createWireSessionHub,
  defineContract,
  memoryTransportPair,
  replaceableTransport,
} from '@emdash/wire/rpc';
import { cell, expose, flushStateTurn } from '@emdash/wire/state';
import { observable, runInAction } from 'mobx';
import { expect, it, vi } from 'vitest';
import { conversationsContract } from '@core/features/conversations/api';
import { installChatUiRuntime } from '@core/features/conversations/api/browser/chat/chat-ui-runtime';
import { AcpChatStore } from '@core/features/conversations/browser/acp/acp-chat-store';
import type { ProjectHostAccessState } from '@core/features/projects/api/browser/stores/project-context';

const fixture = vi.hoisted(() => ({ client: undefined as unknown, context: undefined as unknown }));
vi.mock('@core/features/conversations/api/browser/client', () => ({
  getConversationsClient: async () => fixture.client,
}));
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

it.each([
  'missed-active',
  'observed-active',
  'history-retry',
  'new-prompt',
  'new-active-turn',
  'stale-reattach',
  'disposed',
] as const)('reloads completed history after reconnect: %s', async (mode) => {
  installChatUiRuntime(chatUi);
  const context = chatUi.createChatContext();
  fixture.context = context;
  const idle: SessionState = {
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
  const state = cell(idle);
  const activeTurn = cell<HistoryPage['turns'][number] | null>(null);
  const contract = defineContract({
    acp: defineContract({
      attach: conversationsContract.acp.attach,
      session: conversationsContract.acp.session,
      sendPrompt: conversationsContract.acp.sendPrompt,
      loadHistory: conversationsContract.acp.loadHistory,
    }),
  });
  const session = expose(contract.acp.session, {
    state,
    activeTurn,
    config: cell({ modelOptions: null, efforts: null, modeOptions: null, availableCommands: [] }),
    usage: cell(null),
    plan: cell(null),
    agents: cell([]),
    terminals: cell([]),
    mcpServers: cell([]),
  });
  let history: HistoryPage = { turns: [], nextCursor: null };
  let acceptedPromptId = '';
  const attach = vi.fn(async () => ok(undefined));
  const loadHistory = vi.fn(async () => ok(history));
  const sendPrompt = vi.fn(async ({ promptId }: { promptId: string }) => {
    acceptedPromptId = promptId;
    return ok({ queued: false });
  });
  const hub = createWireSessionHub(
    createController(
      contract,
      {
        acp: { attach, session, loadHistory, sendPrompt },
      },
      { validate: 'full' }
    )
  );
  const transport = replaceableTransport();
  const connection = connect(transport, { maxHeldCalls: 0 });
  fixture.client = client(contract, connection);
  const pair = memoryTransportPair();
  hub.open('desktop-first', pair.right);
  transport.install(pair.left);
  const hostState = observable.box<ProjectHostAccessState>({ kind: 'ready', hostGeneration: 1 });
  const store = new AcpChatStore('conversation-1', 'project-1', 'task-1', {
    get state() {
      return hostState.get();
    },
    get liveAction() {
      return hostState.get().kind === 'ready' ? { kind: 'enabled' } : { kind: 'disabled' };
    },
  } as never);
  const parent = document.createElement('div');
  parent.style.cssText = 'width:800px;height:600px;position:relative';
  document.body.append(parent);
  const view = chatUi.createChatView({ context, state: store.chatState, parent });
  const historyGate = deferred<void>();
  let disposed = false;
  try {
    store.bootstrap();
    await vi.waitFor(() => expect(store.historyLoading).toBe(false));
    expect(store.loadError).toBeNull();
    const live = store.session!;
    const revalidate = vi.spyOn(live, 'revalidate');
    const seed = vi.spyOn(store.chatState.transcript.history, 'seed');
    const send = vi.spyOn(live, 'sendPrompt');
    store.submitPrompt('continue');
    await vi.waitFor(() => expect(send).toHaveResolvedWith(ok({ queued: false })));
    expect(store.chatState.session.state.pendingPrompt?.text).toBe('continue');
    const completed: HistoryPage['turns'][number] = {
      id: 'completed-offline',
      seq: 0,
      initiator: 'user',
      items: [
        {
          kind: 'message',
          id: 'user',
          seq: 0,
          role: 'user',
          text: 'continue',
          promptId: acceptedPromptId,
        },
        { kind: 'message', id: 'agent', seq: 1, role: 'assistant', text: 'Completed remotely.' },
      ],
    };
    if (mode === 'observed-active') {
      activeTurn.set({ ...completed, items: [completed.items[0]] });
      flushStateTurn();
      await vi.waitFor(() => expect(live.activeTurn.current()?.id).toBe(completed.id));
    }
    transport.detach();
    runInAction(() =>
      hostState.set({ kind: 'degraded', situation: 'recovering', recovery: 'automatic' })
    );
    activeTurn.set(completed);
    state.set({ ...idle, activeTurnId: completed.id, agentTurnActive: true, isGenerating: true });
    flushStateTurn();
    history = { turns: [completed], nextCursor: null };
    activeTurn.set(null);
    state.set({ ...idle, lastStopReason: 'end_turn' });
    flushStateTurn();
    if (mode === 'history-retry') {
      loadHistory.mockRejectedValueOnce(new Error('History temporarily unavailable'));
    }
    if (
      mode === 'new-prompt' ||
      mode === 'new-active-turn' ||
      mode === 'stale-reattach' ||
      mode === 'disposed'
    ) {
      loadHistory.mockImplementationOnce(async () => {
        const snapshot = history;
        await historyGate.promise;
        return ok(snapshot);
      });
    }
    const replacement = memoryTransportPair();
    hub.open('desktop-second', replacement.right);
    transport.install(replacement.left);
    runInAction(() => hostState.set({ kind: 'ready', hostGeneration: 2 }));
    await vi.waitFor(() => expect(revalidate).toHaveResolved());
    expect(live.usable).toBe(true);
    expect(live.sessionState.current().lastStopReason).toBe('end_turn');
    expect(live.activeTurn.current()).toBeNull();
    expect(sendPrompt).toHaveBeenCalledOnce();
    expect(attach).toHaveBeenCalledTimes(2);
    if (mode === 'stale-reattach' || mode === 'disposed') {
      await vi.waitFor(() => expect(loadHistory).toHaveBeenCalledTimes(2));
      if (mode === 'disposed') {
        view.dispose();
        store.dispose();
        disposed = true;
        historyGate.resolve();
        await vi.waitFor(() => expect(loadHistory).toHaveResolvedTimes(2));
        expect(seed).not.toHaveBeenCalled();
        return;
      }
      transport.detach();
      runInAction(() =>
        hostState.set({ kind: 'degraded', situation: 'recovering', recovery: 'automatic' })
      );
      // A replacement host snapshot must supersede the read from the previous attachment.
      history = { turns: [{ ...completed, id: 'replacement-history' }], nextCursor: null };
      const third = memoryTransportPair();
      hub.open('desktop-third', third.right);
      transport.install(third.left);
      runInAction(() => hostState.set({ kind: 'ready', hostGeneration: 3 }));
      await vi.waitFor(() => expect(revalidate).toHaveResolvedTimes(2));
      historyGate.resolve();
      await vi.waitFor(() => expect(seed).toHaveBeenCalledOnce());
      expect(seed).toHaveBeenCalledWith(history.turns);
      expect(store.chatState.transcript.state.committedTurns).toEqual(history.turns);
      return;
    }
    if (mode === 'new-prompt' || mode === 'new-active-turn') {
      await vi.waitFor(() => expect(loadHistory).toHaveBeenCalledTimes(2));
      // Same text deliberately: only the prompt id distinguishes the new submission.
      store.submitPrompt('continue');
      await vi.waitFor(() => expect(sendPrompt).toHaveBeenCalledTimes(2));
      const pending = store.chatState.session.state.pendingPrompt;
      expect(pending?.id).toBe(acceptedPromptId);
      store.setDraftText('a newer draft');
      if (mode === 'new-active-turn') {
        const nextTurn: HistoryPage['turns'][number] = {
          id: 'next-turn',
          seq: 1,
          initiator: 'user',
          items: [
            {
              kind: 'message',
              id: 'next-user',
              seq: 0,
              role: 'user',
              text: 'continue',
              promptId: acceptedPromptId,
            },
          ],
        };
        activeTurn.set(nextTurn);
        flushStateTurn();
        await vi.waitFor(() => expect(live.activeTurn.current()?.id).toBe('next-turn'));
        historyGate.resolve();
        await vi.waitFor(() => expect(loadHistory).toHaveResolvedTimes(2));
        expect(store.chatState.transcript.state.activeTurnSnapshot?.id).toBe('next-turn');
        expect(store.chatState.transcript.state.committedTurns).toEqual([]);
        history = { turns: [completed, nextTurn], nextCursor: null };
        activeTurn.set(null);
        flushStateTurn();
        await vi.waitFor(() =>
          expect(store.chatState.transcript.state.committedTurns).toEqual(history.turns)
        );
        expect(store.chatState.session.state.pendingPrompt).toBeNull();
      } else {
        historyGate.resolve();
        await vi.waitFor(() =>
          expect(store.chatState.transcript.state.committedTurns).toEqual([completed])
        );
        expect(store.chatState.session.state.pendingPrompt).toEqual(pending);
      }
      expect(store.draftText).toBe('a newer draft');
      return;
    }
    await vi.waitFor(
      () => expect(store.chatState.transcript.state.committedTurns).toHaveLength(1),
      { timeout: 3_000 }
    );
    await vi.waitFor(() => expect(parent.textContent).toContain('Completed remotely.'));
    expect.soft(store.chatState.transcript.state.committedTurns).toEqual([completed]);
    expect.soft(store.chatState.session.state.pendingPrompt).toBeNull();
  } finally {
    historyGate.resolve();
    if (!disposed) {
      view.dispose();
      store.dispose();
    }
    connection.dispose();
    transport.close();
    await hub.dispose();
    await session.dispose();
    context.dispose();
    parent.remove();
  }
});
