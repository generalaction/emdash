import * as chatUi from '@emdash/chat-ui';
import '@emdash/chat-ui/style.css';
import '@emdash/ui/style.css';
import type {
  HistoryPage,
  SessionState,
  TranscriptTurn,
} from '@emdash/core/runtimes/acp/api/client';
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
import { cell, expose, flushStateTurn, peek } from '@emdash/wire/state';
import { observable, runInAction } from 'mobx';
import { expect, vi } from 'vitest';
import { conversationsContract } from '@core/features/conversations/api';
import { installChatUiRuntime } from '@core/features/conversations/api/browser/chat/chat-ui-runtime';
import { AcpChatStore } from '@core/features/conversations/browser/acp/acp-chat-store';
import type { ProjectHostAccessState } from '@core/features/projects/api/browser/stores/project-context';

export function makeTurn(seq: number, text = `Prompt ${seq}`): TranscriptTurn {
  return {
    id: `turn-${seq}`,
    seq,
    initiator: 'user',
    items: [
      { kind: 'message', id: `user-${seq}`, seq: 0, role: 'user', text, promptId: `prompt-${seq}` },
      { kind: 'message', id: `answer-${seq}`, seq: 1, role: 'assistant', text: `Answer ${seq}` },
    ],
  };
}

export const idleSession: SessionState = {
  lifecycle: 'ready',
  activeTurnId: null,
  historyRevision: 0,
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

/** Real renderer, store and Wire client, with a controlled remote ACP session and history. */
export function createContinuityHarness(
  fixture: { client: unknown; context: unknown },
  initialHistory: readonly TranscriptTurn[] = []
) {
  installChatUiRuntime(chatUi);
  const context = chatUi.createChatContext();
  fixture.context = context;
  const transcriptGeneration = crypto.randomUUID();
  let historyRevision = 0;
  const position = () => ({
    generation: transcriptGeneration,
    historyRevision,
    lastCommittedTurnSeq: history.turns.at(-1)?.seq ?? null,
  });
  const state = cell<SessionState>(idleSession);
  const activeTurn = cell<TranscriptTurn | null>(null);
  const contract = defineContract({
    acp: defineContract({
      attach: conversationsContract.acp.attach,
      startSession: conversationsContract.acp.startSession,
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
  let history: HistoryPage = { turns: [...initialHistory], nextCursor: null };
  history.position = position();
  history.coverage = { fromSeq: null, beforeSeq: null };
  state.set({ ...idleSession, transcript: { ...position(), activeTurn: null } });
  const heldReads: Array<ReturnType<typeof deferred<void>>> = [];
  function historyPage(before?: number, limit = 100): HistoryPage {
    const candidates = history.turns.filter((turn) => before === undefined || turn.seq < before);
    const turns = candidates.slice(-limit);
    const nextCursor = turns.length === limit ? turns[0].seq : null;
    return structuredClone({
      ...history,
      turns,
      nextCursor,
      coverage: { fromSeq: nextCursor, beforeSeq: before ?? null },
    });
  }
  const loadHistory = vi.fn(async (input: { before?: number; limit: number }) =>
    ok(historyPage(input.before, input.limit))
  );
  const attach = vi.fn(async () => ok({ sessionId: 'session-1' }));
  const sendPrompt = vi.fn(async () => ok({ queued: peek(state).isGenerating }));
  const hub = createWireSessionHub(
    createController(
      contract,
      {
        acp: {
          attach,
          startSession: async () => ok({ sessionId: 'session-1' }),
          session,
          loadHistory,
          sendPrompt,
        },
      },
      { validate: 'full' }
    )
  );
  const transport = replaceableTransport();
  const connection = connect(transport, { maxHeldCalls: 0 });
  fixture.client = client(contract, connection);
  let generation = 0;
  function installTransport() {
    const pair = memoryTransportPair();
    hub.open(`desktop-${++generation}`, pair.right);
    transport.install(pair.left);
  }
  installTransport();
  const hostState = observable.box<ProjectHostAccessState>({
    kind: 'ready',
    hostGeneration: generation,
  });
  const store = new AcpChatStore('continuity', 'project', 'task', {
    get state() {
      return hostState.get();
    },
    get liveAction() {
      return hostState.get().kind === 'ready' ? { kind: 'enabled' } : { kind: 'disabled' };
    },
  } as never);
  const parent = document.createElement('div');
  parent.style.cssText = 'width:800px;height:600px;position:fixed;top:0;left:0';
  document.body.append(parent);
  let view: ReturnType<typeof chatUi.createChatView> | null = chatUi.createChatView({
    context,
    state: store.chatState,
    parent,
  });
  const other = chatUi.createChatState(context, { uri: 'other-conversation' });
  other.transcript.history.seed([makeTurn(999, 'A different conversation')]);
  let disposed = false;
  async function settleHistoryReads() {
    await Promise.allSettled(loadHistory.mock.results.map((result) => result.value));
    // Let the in-memory transport deliver server responses and the client run its
    // continuations before checking ignored responses or tearing down the connection.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }

  return {
    store,
    parent,
    loadHistory,
    attach,
    sendPrompt,
    settleHistoryReads,
    get texts() {
      return parent.textContent ?? '';
    },
    get committed() {
      return store.chatState.transcript.state.committedTurns;
    },
    get active() {
      return store.chatState.transcript.state.activeTurnSnapshot;
    },
    async bootstrap() {
      store.bootstrap();
      await vi.waitFor(() => expect(store.historyLoading).toBe(false));
      expect(store.loadError).toBeNull();
    },
    startBootstrap() {
      store.bootstrap();
    },
    setHistory(turns: readonly TranscriptTurn[], unavailable = false) {
      historyRevision += 1;
      history = {
        turns: structuredClone([...turns]),
        nextCursor: null,
        ...(unavailable && { unavailable: true }),
      };
      history.position = position();
      history.coverage = { fromSeq: null, beforeSeq: null };
      state.set({
        ...peek(state),
        historyRevision,
        transcript: { ...position(), activeTurn: peek(activeTurn) },
      });
    },
    holdNextHistory() {
      const started = deferred<void>();
      const gate = deferred<void>();
      heldReads.push(gate);
      loadHistory.mockImplementationOnce(async (input) => {
        const captured = historyPage(input.before, input.limit);
        started.resolve();
        await gate.promise;
        return ok(captured);
      });
      return {
        started: started.promise,
        release: () => gate.resolve(),
        reject: (error: Error) => gate.reject(error),
      };
    },
    publish(turn: TranscriptTurn | null, patch: Partial<SessionState> = {}) {
      activeTurn.set(turn);
      state.set({
        ...peek(state),
        lifecycle: turn ? 'working' : 'ready',
        activeTurnId: turn?.id ?? null,
        isGenerating: turn !== null,
        agentTurnActive: turn !== null,
        canCancel: turn !== null,
        ...patch,
        transcript: { ...position(), activeTurn: turn },
      });
    },
    flush() {
      flushStateTurn();
    },
    async observe(turn: TranscriptTurn | null) {
      flushStateTurn();
      await vi.waitFor(() =>
        expect(store.session?.activeTurn.current()?.id ?? null).toBe(turn?.id ?? null)
      );
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    },
    switchAway() {
      view?.setModel(other);
    },
    switchBack() {
      view?.setModel(store.chatState);
    },
    unmount() {
      view?.dispose();
      view = null;
    },
    remount() {
      view?.dispose();
      view = chatUi.createChatView({ context, state: store.chatState, parent });
    },
    disconnect() {
      transport.detach();
      runInAction(() =>
        hostState.set({ kind: 'degraded', situation: 'recovering', recovery: 'automatic' })
      );
    },
    reconnect() {
      installTransport();
      runInAction(() => hostState.set({ kind: 'ready', hostGeneration: generation }));
    },
    disposeStore() {
      if (disposed) return;
      view?.dispose();
      view = null;
      store.dispose();
      disposed = true;
    },
    async dispose() {
      for (const gate of heldReads) gate.resolve();
      if (!disposed) {
        view?.dispose();
        store.dispose();
        disposed = true;
      }
      await settleHistoryReads();
      connection.dispose();
      transport.close();
      await hub.dispose();
      await session.dispose();
      other.dispose();
      context.dispose();
      parent.remove();
    },
  };
}
