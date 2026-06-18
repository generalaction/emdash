/**
 * Unit tests for ChatStore pull-based model.
 *
 * Validates:
 * - History rebuild from getChatHistory commits turns deterministically (no stuck thinking).
 * - Active turn from getSessionState streams without finalizing.
 * - Live updates racing the initial query are deduplicated by seq.
 * - acpTurnCommittedChannel finalizes streaming state.
 * - acpSessionStateChannel drives isWorking/isReady/isClosed.
 */
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatHistory, SessionState } from '@shared/core/acp/acpTurns';
import type { AcpTurn } from '@shared/core/acp/acpTurns';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Listener registry: channel name → handler function.
const listeners = new Map<string, (payload: unknown) => void>();

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: vi.fn((channel: { name: string }, handler: (payload: unknown) => void) => {
      listeners.set(channel.name, handler);
      return () => listeners.delete(channel.name);
    }),
  },
  rpc: {
    acp: {
      getSessionState: vi.fn(),
      getChatHistory: vi.fn(),
      prompt: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn().mockResolvedValue(undefined),
      setModel: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

vi.mock('@renderer/utils/logger', () => ({
  log: { warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock('@renderer/features/tasks/stores/task-selectors', () => ({
  asProvisioned: vi.fn(() => null),
  getTaskStore: vi.fn(() => null),
}));

vi.mock('@renderer/features/tasks/stores/workspace-file-resolver', () => ({
  createWorkspaceFileResolver: vi.fn(() => ({
    classifyLink: vi.fn(() => ({ kind: 'external' })),
    resolve: vi.fn(async () => ({ kind: 'opaque' })),
    reEnrichStale: vi.fn(async () => {}),
    clear: vi.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import {
  acpSessionStateChannel,
  acpSessionUpdateChannel,
  acpTurnCommittedChannel,
} from '@shared/core/acp/acpEvents';
import { ChatStore } from './chat-store';
import type { ChatMessageItem } from './chat-store';

/** Emit a channel event and run all pending microtasks. */
async function emit(channel: { name: string }, payload: unknown): Promise<void> {
  const handler = listeners.get(channel.name);
  if (!handler) throw new Error(`No listener registered for channel: ${channel.name}`);
  handler(payload);
  await Promise.resolve();
}

/** Flush all microtasks (resolves async bootstrap queries etc.). */
async function flushAsync(ticks = 5): Promise<void> {
  for (let i = 0; i < ticks; i++) await Promise.resolve();
}

function makeActiveTurn(overrides: Partial<AcpTurn> = {}): AcpTurn {
  return {
    id: 'turn-1',
    status: 'active',
    source: 'live',
    startSeq: 0,
    endSeq: null,
    updates: [],
    ...overrides,
  };
}

function makeCompleteTurn(
  updates: AcpTurn['updates'] = [],
  overrides: Partial<AcpTurn> = {}
): AcpTurn {
  return {
    id: 'turn-hist-1',
    status: 'complete',
    source: 'live',
    startSeq: 0,
    endSeq: updates.length,
    updates,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChatStore – bootstrap via getChatHistory + getSessionState', () => {
  let rpcMock: { acp: { getSessionState: Mock; getChatHistory: Mock } };

  beforeEach(async () => {
    listeners.clear();
    const { rpc } = await import('@renderer/lib/ipc');
    rpcMock = rpc as unknown as typeof rpcMock;
  });

  afterEach(() => {
    vi.clearAllMocks();
    listeners.clear();
  });

  it('rebuilds items from committed history without stuck thinking', async () => {
    const msgUpdate = {
      sessionUpdate: 'agent_message_chunk' as const,
      content: { type: 'text' as const, text: 'hello' },
      messageId: 'msg-1',
    };
    const thoughtUpdate = {
      sessionUpdate: 'agent_thought_chunk' as const,
      content: { type: 'text' as const, text: 'thinking...' },
      messageId: 'thought-1',
    };

    const history: ChatHistory = {
      turns: [
        makeCompleteTurn(
          [
            { seq: 0, update: thoughtUpdate },
            { seq: 1, update: msgUpdate },
          ],
          { id: 'turn-1' }
        ),
      ],
      complete: true,
    };
    const state: SessionState = { lifecycle: 'ready', activeTurn: null, model: null };

    rpcMock.acp.getChatHistory.mockResolvedValue(history);
    rpcMock.acp.getSessionState.mockResolvedValue(state);

    const store = new ChatStore('conv-1', 'proj-1', 'task-1');
    await flushAsync(10);

    // Should have thought + message items.
    expect(store.items.some((it) => it.kind === 'message' && it.role === 'thought')).toBe(true);
    expect(store.items.some((it) => it.kind === 'message' && it.role === 'assistant')).toBe(true);

    // No item should be stuck streaming (regression test for stuck thinking).
    const streaming = store.items.filter((it) => it.kind === 'message' && it.streaming);
    expect(streaming).toHaveLength(0);

    expect(store.isReady).toBe(true);
    expect(store.isWorking).toBe(false);
  });

  it('rebuilds active turn updates without finalizing them', async () => {
    const msgUpdate = {
      sessionUpdate: 'agent_message_chunk' as const,
      content: { type: 'text' as const, text: 'streaming...' },
      messageId: 'msg-1',
    };

    const history: ChatHistory = { turns: [], complete: true };
    const state: SessionState = {
      lifecycle: 'working',
      activeTurn: makeActiveTurn({
        updates: [{ seq: 0, update: msgUpdate }],
      }),
      model: null,
    };

    rpcMock.acp.getChatHistory.mockResolvedValue(history);
    rpcMock.acp.getSessionState.mockResolvedValue(state);

    const store = new ChatStore('conv-1', 'proj-1', 'task-1');
    await flushAsync(10);

    // Item should be streaming (not finalized).
    const assistantItems = store.items.filter(
      (it): it is ChatMessageItem => it.kind === 'message' && it.role === 'assistant'
    );
    expect(assistantItems).toHaveLength(1);
    expect(assistantItems[0].streaming).toBe(true);

    expect(store.isWorking).toBe(true);
    expect(store.isReady).toBe(true);
  });

  it('deduplicates live updates that race the initial query by seq', async () => {
    const msgUpdate = {
      sessionUpdate: 'agent_message_chunk' as const,
      content: { type: 'text' as const, text: 'hi' },
      messageId: 'msg-dedup',
    };

    let resolveHistory!: (h: ChatHistory) => void;
    const historyPromise = new Promise<ChatHistory>((res) => {
      resolveHistory = res;
    });

    const history: ChatHistory = { turns: [], complete: true };
    const state: SessionState = {
      lifecycle: 'working',
      activeTurn: makeActiveTurn({ updates: [{ seq: 0, update: msgUpdate }] }),
      model: null,
    };

    rpcMock.acp.getChatHistory.mockReturnValue(historyPromise);
    rpcMock.acp.getSessionState.mockResolvedValue(state);

    const store = new ChatStore('conv-1', 'proj-1', 'task-1');
    // Flush enough to register listeners but not resolve the history query.
    await Promise.resolve();

    // Emit seq=0 live update before history resolves.
    await emit(acpSessionUpdateChannel, {
      conversationId: 'conv-1',
      turnId: 'turn-1',
      update: msgUpdate,
      seq: 0,
    });

    // Resolve the history query (active turn has seq=0 already).
    resolveHistory(history);
    await flushAsync(10);

    // 'hi' should appear only once.
    const assistantItems = store.items.filter(
      (it): it is ChatMessageItem => it.kind === 'message' && it.role === 'assistant'
    );
    expect(assistantItems.map((it) => it.text).join('')).toBe('hi');
  });

  it('applies live updates with seq > lastSeq after history is loaded', async () => {
    const history: ChatHistory = { turns: [], complete: true };
    const state: SessionState = { lifecycle: 'ready', activeTurn: null, model: null };

    rpcMock.acp.getChatHistory.mockResolvedValue(history);
    rpcMock.acp.getSessionState.mockResolvedValue(state);

    const store = new ChatStore('conv-1', 'proj-1', 'task-1');
    await flushAsync(10); // bootstrap complete

    await emit(acpSessionStateChannel, {
      conversationId: 'conv-1',
      lifecycle: 'working',
      activeTurnId: 'turn-live',
    });

    await emit(acpSessionUpdateChannel, {
      conversationId: 'conv-1',
      turnId: 'turn-live',
      update: {
        sessionUpdate: 'agent_message_chunk' as const,
        content: { type: 'text' as const, text: 'new' },
        messageId: 'msg-live',
      },
      seq: 0,
    });

    const assistantItems = store.items.filter(
      (it): it is ChatMessageItem => it.kind === 'message' && it.role === 'assistant'
    );
    expect(assistantItems).toHaveLength(1);
    expect(assistantItems[0].text).toBe('new');
    expect(store.isWorking).toBe(true);
  });
});

describe('ChatStore – event channel subscriptions', () => {
  beforeEach(() => {
    listeners.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
    listeners.clear();
  });

  it('acpSessionStateChannel drives isWorking / isReady / isClosed', async () => {
    const { rpc } = await import('@renderer/lib/ipc');
    const rpc_ = rpc as unknown as { acp: { getSessionState: Mock; getChatHistory: Mock } };
    rpc_.acp.getChatHistory.mockResolvedValue({ turns: [], complete: true });
    rpc_.acp.getSessionState.mockResolvedValue({
      lifecycle: 'ready',
      activeTurn: null,
      model: null,
    });

    const store = new ChatStore('conv-1', 'proj-1', 'task-1');
    await flushAsync(10);

    await emit(acpSessionStateChannel, {
      conversationId: 'conv-1',
      lifecycle: 'working',
      activeTurnId: 'turn-x',
    });
    expect(store.isWorking).toBe(true);
    expect(store.isReady).toBe(true);
    expect(store.isClosed).toBe(false);

    await emit(acpSessionStateChannel, {
      conversationId: 'conv-1',
      lifecycle: 'ready',
      activeTurnId: null,
    });
    expect(store.isWorking).toBe(false);
    expect(store.isReady).toBe(true);

    await emit(acpSessionStateChannel, {
      conversationId: 'conv-1',
      lifecycle: 'closed',
      activeTurnId: null,
    });
    expect(store.isClosed).toBe(true);
    expect(store.isWorking).toBe(false);
  });

  it('acpTurnCommittedChannel finalizes streaming items (turn_done)', async () => {
    const { rpc } = await import('@renderer/lib/ipc');
    const rpc_ = rpc as unknown as { acp: { getSessionState: Mock; getChatHistory: Mock } };

    const msgUpdate = {
      sessionUpdate: 'agent_message_chunk' as const,
      content: { type: 'text' as const, text: 'hi' },
      messageId: 'msg-commit',
    };

    const history: ChatHistory = { turns: [], complete: true };
    const state: SessionState = {
      lifecycle: 'working',
      activeTurn: makeActiveTurn({
        updates: [{ seq: 0, update: msgUpdate }],
      }),
      model: null,
    };

    rpc_.acp.getChatHistory.mockResolvedValue(history);
    rpc_.acp.getSessionState.mockResolvedValue(state);

    const store = new ChatStore('conv-1', 'proj-1', 'task-1');
    await flushAsync(10);

    // Should be streaming.
    expect(store.items.some((it) => it.kind === 'message' && it.streaming)).toBe(true);

    // Commit the turn.
    await emit(acpTurnCommittedChannel, {
      conversationId: 'conv-1',
      turn: makeCompleteTurn([{ seq: 0, update: msgUpdate }]),
    });

    // No more streaming items.
    const streaming = store.items.filter((it) => it.kind === 'message' && it.streaming);
    expect(streaming).toHaveLength(0);
  });

  it('ignores events for other conversation ids', async () => {
    const { rpc } = await import('@renderer/lib/ipc');
    const rpc_ = rpc as unknown as { acp: { getSessionState: Mock; getChatHistory: Mock } };
    rpc_.acp.getChatHistory.mockResolvedValue({ turns: [], complete: true });
    rpc_.acp.getSessionState.mockResolvedValue({
      lifecycle: 'ready',
      activeTurn: null,
      model: null,
    });

    const store = new ChatStore('conv-1', 'proj-1', 'task-1');
    await flushAsync(10);

    // Emit for a different conversation.
    await emit(acpSessionStateChannel, {
      conversationId: 'other-conv',
      lifecycle: 'working',
      activeTurnId: 'turn-x',
    });

    expect(store.isWorking).toBe(false);
  });
});
