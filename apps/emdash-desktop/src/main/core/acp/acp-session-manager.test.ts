import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks (declared before imports)
// ---------------------------------------------------------------------------

let capturedHandlerFactory: ((agent: unknown) => object) | null = null;

// Per-test mutable connection reference (reset each test via property mutation).
const mockConnection: {
  initialize: Mock;
  newSession: Mock;
  loadSession: Mock;
  closeSession: Mock;
  cancel: Mock;
  prompt: Mock;
  setSessionConfigOption: Mock;
  closed: Promise<void>;
} = {
  initialize: vi.fn().mockResolvedValue({ protocolVersion: 1 }),
  newSession: vi.fn().mockResolvedValue({ sessionId: 'session-1' }),
  loadSession: vi.fn().mockResolvedValue({}),
  closeSession: vi.fn().mockResolvedValue({}),
  cancel: vi.fn().mockResolvedValue({}),
  prompt: vi.fn().mockResolvedValue({ stopReason: 'end_turn' }),
  setSessionConfigOption: vi.fn().mockResolvedValue({}),
  closed: new Promise<void>(() => {}),
};

vi.mock('@agentclientprotocol/sdk', () => ({
  // Use a regular function (not arrow) so it works as a constructor.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ClientSideConnection: function (handlerFactory: (a: unknown) => object): any {
    capturedHandlerFactory = handlerFactory;
    // Returning a non-primitive from a constructor uses that object as the instance.
    return mockConnection;
  },
  ndJsonStream: vi.fn().mockReturnValue({}),
}));

vi.mock('@agentclientprotocol/claude-agent-acp/dist/utils.js', () => ({
  nodeToWebReadable: vi.fn().mockReturnValue({}),
  nodeToWebWritable: vi.fn().mockReturnValue({}),
}));

const mockChild = {
  stdin: { write: vi.fn() },
  stdout: { on: vi.fn() },
  stderr: { on: vi.fn() },
  exitCode: null as number | null,
  kill: vi.fn(),
  on: vi.fn(),
};

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => mockChild),
}));

vi.mock('@main/core/pty/pty-env', () => ({
  buildAgentEnv: vi.fn(() => ({})),
}));

vi.mock('@main/core/agents/plugin-registry', () => ({
  getPlugin: vi.fn(() => ({
    capabilities: { acp: { kind: 'supported' } },
    behavior: {
      acp: {
        buildSpawn: () => ({
          command: '/usr/bin/node',
          args: ['agent.js'],
          env: {},
        }),
      },
    },
  })),
}));

vi.mock('@main/core/agent-hooks/agent-hook-service', () => ({
  agentHookService: { emitAgentEvent: vi.fn() },
}));

vi.mock('@main/core/agent-hooks/notification', () => ({
  isAppFocused: vi.fn(() => false),
}));

vi.mock('@main/core/conversations/set-provider-session-id', () => ({
  setProviderSessionId: vi.fn().mockResolvedValue(true),
}));

vi.mock('@main/core/conversations/updateConversationModel', () => ({
  updateConversationModel: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@main/lib/events', () => ({
  events: { emit: vi.fn() },
}));

vi.mock('@main/lib/logger', () => ({
  log: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import type { Conversation } from '@shared/core/conversations/conversations';
import { AcpSessionManager } from './acp-session-manager';

const makeConversation = (overrides: { conversationId?: string } = {}): Conversation => ({
  id: overrides.conversationId ?? 'conv-1',
  providerId: 'claude',
  projectId: 'proj-1',
  taskId: 'task-1',
  providerSessionId: undefined,
  model: undefined,
  type: 'acp',
  title: 'Test Chat',
  lastInteractedAt: null,
  isInitialConversation: false,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AcpSessionManager – pooling', () => {
  beforeEach(() => {
    capturedHandlerFactory = null;
    mockConnection.initialize = vi.fn().mockResolvedValue({ protocolVersion: 1 });
    mockConnection.newSession = vi.fn().mockResolvedValue({ sessionId: 'session-1' });
    mockConnection.loadSession = vi.fn().mockResolvedValue({});
    mockConnection.closeSession = vi.fn().mockResolvedValue({});
    mockConnection.cancel = vi.fn().mockResolvedValue({});
    mockConnection.prompt = vi.fn().mockResolvedValue({ stopReason: 'end_turn' });
    mockConnection.setSessionConfigOption = vi.fn().mockResolvedValue({});
    mockConnection.closed = new Promise<void>(() => {});
    (spawn as Mock).mockClear();
    (spawn as Mock).mockReturnValue(mockChild);
    mockChild.kill.mockReset();
    mockChild.on.mockReset();
  });

  it('two conversations in the same workspace share one child process', async () => {
    const manager = new AcpSessionManager();

    const convA = makeConversation({ conversationId: 'conv-a' });
    const convB = makeConversation({ conversationId: 'conv-b' });

    (mockConnection.newSession as Mock)
      .mockResolvedValueOnce({ sessionId: 'session-a' })
      .mockResolvedValueOnce({ sessionId: 'session-b' });

    await manager.start(convA, 'ws-1', '/tmp/workspace');
    await manager.start(convB, 'ws-1', '/tmp/workspace');

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(mockConnection.newSession).toHaveBeenCalledTimes(2);
  });

  it('a third conversation in a different workspace spawns a second child', async () => {
    const manager = new AcpSessionManager();

    (mockConnection.newSession as Mock).mockResolvedValue({ sessionId: 'session-x' });

    const convA = makeConversation({ conversationId: 'conv-a' });
    const convC = makeConversation({ conversationId: 'conv-c' });

    await manager.start(convA, 'ws-1', '/ws1');
    await manager.start(convC, 'ws-2', '/ws2');

    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('stop on one of two pooled conversations keeps the child alive', async () => {
    const manager = new AcpSessionManager();

    (mockConnection.newSession as Mock)
      .mockResolvedValueOnce({ sessionId: 'session-a' })
      .mockResolvedValueOnce({ sessionId: 'session-b' });

    await manager.start(makeConversation({ conversationId: 'conv-a' }), 'ws-1', '/tmp/workspace');
    await manager.start(makeConversation({ conversationId: 'conv-b' }), 'ws-1', '/tmp/workspace');

    manager.stop('conv-a');

    expect(mockChild.kill).not.toHaveBeenCalled();
    expect(manager.isRunning('conv-b')).toBe(true);
  });

  it('stop on the last conversation kills the child', async () => {
    const manager = new AcpSessionManager();

    (mockConnection.newSession as Mock)
      .mockResolvedValueOnce({ sessionId: 'session-a' })
      .mockResolvedValueOnce({ sessionId: 'session-b' });

    await manager.start(makeConversation({ conversationId: 'conv-a' }), 'ws-1', '/tmp/workspace');
    await manager.start(makeConversation({ conversationId: 'conv-b' }), 'ws-1', '/tmp/workspace');

    manager.stop('conv-a');
    manager.stop('conv-b');

    expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');
  });
});

describe('AcpSessionManager – routing', () => {
  beforeEach(() => {
    capturedHandlerFactory = null;
    mockConnection.initialize = vi.fn().mockResolvedValue({ protocolVersion: 1 });
    mockConnection.newSession = vi.fn().mockResolvedValue({ sessionId: 'session-1' });
    mockConnection.loadSession = vi.fn().mockResolvedValue({});
    mockConnection.closeSession = vi.fn().mockResolvedValue({});
    mockConnection.cancel = vi.fn().mockResolvedValue({});
    mockConnection.prompt = vi.fn().mockResolvedValue({ stopReason: 'end_turn' });
    mockConnection.setSessionConfigOption = vi.fn().mockResolvedValue({});
    mockConnection.closed = new Promise<void>(() => {});
    (spawn as Mock).mockReturnValue(mockChild);
    mockChild.kill.mockReset();
    mockChild.on.mockReset();
  });

  it('sessionUpdate routes to the correct conversationId and emits turnId + seq', async () => {
    const { events } = await import('@main/lib/events');
    const { acpSessionUpdateChannel } = await import('@shared/core/acp/acpEvents');

    (events.emit as Mock).mockReset();

    const manager = new AcpSessionManager();

    (mockConnection.newSession as Mock)
      .mockResolvedValueOnce({ sessionId: 'session-a' })
      .mockResolvedValueOnce({ sessionId: 'session-b' });

    await manager.start(makeConversation({ conversationId: 'conv-a' }), 'ws-1', '/tmp/workspace');
    await manager.start(makeConversation({ conversationId: 'conv-b' }), 'ws-1', '/tmp/workspace');

    expect(capturedHandlerFactory).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = capturedHandlerFactory!(null) as any;

    (events.emit as Mock).mockReset();

    await handler.sessionUpdate({
      sessionId: 'session-b',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello' } },
    });

    expect(events.emit).toHaveBeenCalledWith(acpSessionUpdateChannel, {
      conversationId: 'conv-b',
      turnId: expect.any(String),
      update: expect.objectContaining({ sessionUpdate: 'agent_message_chunk' }),
      seq: expect.any(Number),
    });
  });

  it('reconnecting with a providerSessionId calls loadSession and emits a replay turn', async () => {
    const { events } = await import('@main/lib/events');
    const { acpSessionStateChannel, acpTurnCommittedChannel } =
      await import('@shared/core/acp/acpEvents');

    (events.emit as Mock).mockReset();

    const manager = new AcpSessionManager();

    const conv = {
      ...makeConversation({ conversationId: 'conv-replay' }),
      providerSessionId: 'existing-session-42',
    };

    await manager.start(conv, 'ws-1', '/tmp/workspace');

    expect(mockConnection.loadSession).toHaveBeenCalledWith({
      sessionId: 'existing-session-42',
      cwd: '/tmp/workspace',
      mcpServers: [],
    });
    expect(mockConnection.newSession).not.toHaveBeenCalled();

    // Should emit acpSessionStateChannel with lifecycle 'replaying' (openTurn)
    // then 'ready' (closeTurn + final ready).
    const stateCalls = (events.emit as Mock).mock.calls.filter(
      (args: unknown[]) => args[0] === acpSessionStateChannel
    );
    const lifecycles = stateCalls.map(
      (args: unknown[]) => (args[1] as { lifecycle: string }).lifecycle
    );
    expect(lifecycles).toContain('replaying');
    expect(lifecycles).toContain('ready');

    // The replay turn should be committed.
    const committedCalls = (events.emit as Mock).mock.calls.filter(
      (args: unknown[]) => args[0] === acpTurnCommittedChannel
    );
    expect(committedCalls).toHaveLength(1);
    expect(committedCalls[0][1]).toMatchObject({
      conversationId: 'conv-replay',
      turn: expect.objectContaining({ source: 'replay', status: 'complete' }),
    });
  });

  it('falls back to newSession when loadSession throws; replay turn is committed as complete', async () => {
    const { events } = await import('@main/lib/events');
    const { acpTurnCommittedChannel } = await import('@shared/core/acp/acpEvents');

    (events.emit as Mock).mockReset();

    const manager = new AcpSessionManager();

    mockConnection.loadSession = vi.fn().mockRejectedValue(new Error('load failed'));
    mockConnection.newSession = vi.fn().mockResolvedValue({ sessionId: 'fallback-session' });

    const conv = {
      ...makeConversation({ conversationId: 'conv-fallback' }),
      providerSessionId: 'bad-session',
    };

    await manager.start(conv, 'ws-1', '/tmp/workspace');

    expect(mockConnection.loadSession).toHaveBeenCalled();
    expect(mockConnection.newSession).toHaveBeenCalled();
    expect(manager.isRunning('conv-fallback')).toBe(true);

    // Replay turn is still committed even on failure.
    const committedCalls = (events.emit as Mock).mock.calls.filter(
      (args: unknown[]) => args[0] === acpTurnCommittedChannel
    );
    expect(committedCalls).toHaveLength(1);
    expect(committedCalls[0][1]).toMatchObject({
      conversationId: 'conv-fallback',
      turn: expect.objectContaining({ source: 'replay', status: 'complete' }),
    });
  });

  it('loadSession replay: agent-assigned session ID is dynamically registered and routed', async () => {
    const { events } = await import('@main/lib/events');
    const { acpSessionUpdateChannel } = await import('@shared/core/acp/acpEvents');
    const { setProviderSessionId } =
      await import('@main/core/conversations/set-provider-session-id');

    (events.emit as Mock).mockReset();
    (setProviderSessionId as Mock).mockClear();

    const manager = new AcpSessionManager();

    mockConnection.loadSession = vi.fn().mockImplementation(async () => {
      expect(capturedHandlerFactory).not.toBeNull();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handler = capturedHandlerFactory!(null) as any;
      await handler.sessionUpdate({
        sessionId: 'agent-assigned-session-99',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } },
      });
      return {};
    });
    mockConnection.newSession = vi.fn();

    const conv = {
      ...makeConversation({ conversationId: 'conv-dynamic' }),
      providerSessionId: 'stored-session-id',
    };

    await manager.start(conv, 'ws-1', '/tmp/workspace');

    const updateEmits = (events.emit as Mock).mock.calls.filter(
      (args: unknown[]) => args[0] === acpSessionUpdateChannel
    );
    expect(updateEmits).toHaveLength(1);
    expect(updateEmits[0][1]).toMatchObject({
      conversationId: 'conv-dynamic',
      turnId: expect.any(String),
      update: expect.objectContaining({ sessionUpdate: 'agent_message_chunk' }),
    });

    expect(mockConnection.newSession).not.toHaveBeenCalled();
    expect(setProviderSessionId).toHaveBeenCalledWith('conv-dynamic', 'agent-assigned-session-99');
    expect(manager.isRunning('conv-dynamic')).toBe(true);
  });

  it('sessionUpdate for unknown sessionId does not emit an event', async () => {
    const { events } = await import('@main/lib/events');
    const { acpSessionUpdateChannel } = await import('@shared/core/acp/acpEvents');

    (events.emit as Mock).mockReset();

    const manager = new AcpSessionManager();

    (mockConnection.newSession as Mock).mockResolvedValue({ sessionId: 'session-a' });
    await manager.start(makeConversation({ conversationId: 'conv-a' }), 'ws-1', '/tmp/workspace');

    expect(capturedHandlerFactory).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = capturedHandlerFactory!(null) as any;

    (events.emit as Mock).mockReset();

    await handler.sessionUpdate({
      sessionId: 'unknown-session-xyz',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ghost' } },
    });

    const acpUpdateEmits = (events.emit as Mock).mock.calls.filter(
      (args: unknown[]) => args[0] === acpSessionUpdateChannel
    );
    expect(acpUpdateEmits).toHaveLength(0);
  });
});

describe('AcpSessionManager – turn model', () => {
  beforeEach(() => {
    capturedHandlerFactory = null;
    mockConnection.initialize = vi.fn().mockResolvedValue({ protocolVersion: 1 });
    mockConnection.newSession = vi.fn().mockResolvedValue({ sessionId: 'session-1' });
    mockConnection.loadSession = vi.fn().mockResolvedValue({});
    mockConnection.closeSession = vi.fn().mockResolvedValue({});
    mockConnection.cancel = vi.fn().mockResolvedValue({});
    mockConnection.prompt = vi.fn().mockResolvedValue({ stopReason: 'end_turn' });
    mockConnection.setSessionConfigOption = vi.fn().mockResolvedValue({});
    mockConnection.closed = new Promise<void>(() => {});
    (spawn as Mock).mockReturnValue(mockChild);
    mockChild.kill.mockReset();
    mockChild.on.mockReset();
  });

  it('prompt() opens a live turn, commits it as complete on end_turn stopReason', async () => {
    const { events } = await import('@main/lib/events');
    const { acpSessionStateChannel, acpTurnCommittedChannel } =
      await import('@shared/core/acp/acpEvents');

    const manager = new AcpSessionManager();
    (mockConnection.newSession as Mock).mockResolvedValue({ sessionId: 'session-1' });
    await manager.start(makeConversation({ conversationId: 'conv-1' }), 'ws-1', '/tmp');

    (events.emit as Mock).mockReset();
    mockConnection.prompt = vi.fn().mockResolvedValue({ stopReason: 'end_turn' });

    await manager.prompt('conv-1', 'hello');

    const stateCalls = (events.emit as Mock).mock.calls.filter(
      (args: unknown[]) => args[0] === acpSessionStateChannel
    );
    const lifecycles = stateCalls.map((a: unknown[]) => (a[1] as { lifecycle: string }).lifecycle);
    expect(lifecycles).toContain('working');
    expect(lifecycles).toContain('ready');

    const committedCalls = (events.emit as Mock).mock.calls.filter(
      (args: unknown[]) => args[0] === acpTurnCommittedChannel
    );
    expect(committedCalls).toHaveLength(1);
    expect(committedCalls[0][1]).toMatchObject({
      conversationId: 'conv-1',
      turn: expect.objectContaining({ source: 'live', status: 'complete' }),
    });
  });

  it('prompt() commits turn as cancelled when stopReason is cancelled', async () => {
    const { events } = await import('@main/lib/events');
    const { acpTurnCommittedChannel } = await import('@shared/core/acp/acpEvents');

    const manager = new AcpSessionManager();
    (mockConnection.newSession as Mock).mockResolvedValue({ sessionId: 'session-1' });
    await manager.start(makeConversation({ conversationId: 'conv-1' }), 'ws-1', '/tmp');

    (events.emit as Mock).mockReset();
    mockConnection.prompt = vi.fn().mockResolvedValue({ stopReason: 'cancelled' });

    await manager.prompt('conv-1', 'hi');

    const committedCalls = (events.emit as Mock).mock.calls.filter(
      (args: unknown[]) => args[0] === acpTurnCommittedChannel
    );
    expect(committedCalls).toHaveLength(1);
    expect(committedCalls[0][1]).toMatchObject({
      turn: expect.objectContaining({ status: 'cancelled' }),
    });
  });

  it('prompt() commits turn as error when prompt() rejects', async () => {
    const { events } = await import('@main/lib/events');
    const { acpTurnCommittedChannel } = await import('@shared/core/acp/acpEvents');

    const manager = new AcpSessionManager();
    (mockConnection.newSession as Mock).mockResolvedValue({ sessionId: 'session-1' });
    await manager.start(makeConversation({ conversationId: 'conv-1' }), 'ws-1', '/tmp');

    (events.emit as Mock).mockReset();
    mockConnection.prompt = vi.fn().mockRejectedValue(new Error('boom'));

    await manager.prompt('conv-1', 'fail');

    const committedCalls = (events.emit as Mock).mock.calls.filter(
      (args: unknown[]) => args[0] === acpTurnCommittedChannel
    );
    expect(committedCalls).toHaveLength(1);
    expect(committedCalls[0][1]).toMatchObject({
      turn: expect.objectContaining({ status: 'error' }),
    });
  });

  it('getChatHistory returns only committed turns and correct complete flag', async () => {
    const manager = new AcpSessionManager();
    (mockConnection.newSession as Mock).mockResolvedValue({ sessionId: 'session-hist' });

    // Before session started: empty, complete=true (nothing in-flight).
    expect(manager.getChatHistory('no-such-conv')).toEqual({ turns: [], complete: true });

    await manager.start(makeConversation({ conversationId: 'conv-hist' }), 'ws-1', '/tmp');

    // After start (no replay, no turns yet): empty turns, complete=true (ready).
    let history = manager.getChatHistory('conv-hist');
    expect(history.turns).toHaveLength(0);
    expect(history.complete).toBe(true);

    // Run a prompt to create + commit a turn.
    mockConnection.prompt = vi.fn().mockResolvedValue({ stopReason: 'end_turn' });
    await manager.prompt('conv-hist', 'hello');

    history = manager.getChatHistory('conv-hist');
    expect(history.turns).toHaveLength(1);
    expect(history.turns[0].status).toBe('complete');
    expect(history.complete).toBe(true);
  });

  it('getSessionState returns active turn mid-prompt', async () => {
    const manager = new AcpSessionManager();
    (mockConnection.newSession as Mock).mockResolvedValue({ sessionId: 'session-state' });
    await manager.start(makeConversation({ conversationId: 'conv-state' }), 'ws-1', '/tmp');

    let promptResolved = false;
    let resolvePrompt!: (val: { stopReason: string }) => void;
    mockConnection.prompt = vi.fn().mockReturnValue(
      new Promise((res) => {
        resolvePrompt = res;
      })
    );

    const promptPromise = manager.prompt('conv-state', 'hi');

    // Mid-flight: getSessionState should show working + activeTurn.
    const stateMidFlight = manager.getSessionState('conv-state');
    expect(stateMidFlight.lifecycle).toBe('working');
    expect(stateMidFlight.activeTurn).not.toBeNull();
    expect(stateMidFlight.activeTurn?.status).toBe('active');

    resolvePrompt({ stopReason: 'end_turn' });
    await promptPromise;
    promptResolved = true;

    // After prompt: no active turn.
    const stateAfter = manager.getSessionState('conv-state');
    expect(stateAfter.lifecycle).toBe('ready');
    expect(stateAfter.activeTurn).toBeNull();
    expect(promptResolved).toBe(true);
  });

  it('sessionUpdate attributes to active turn with incrementing seq and emits turnId', async () => {
    const { events } = await import('@main/lib/events');
    const { acpSessionUpdateChannel } = await import('@shared/core/acp/acpEvents');

    (events.emit as Mock).mockReset();

    const manager = new AcpSessionManager();
    (mockConnection.newSession as Mock).mockResolvedValue({ sessionId: 'session-buf' });
    await manager.start(makeConversation({ conversationId: 'conv-buf' }), 'ws-1', '/tmp/workspace');

    expect(capturedHandlerFactory).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = capturedHandlerFactory!(null) as any;

    const update1 = { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'a' } };
    const update2 = { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'b' } };

    await handler.sessionUpdate({ sessionId: 'session-buf', update: update1 });
    await handler.sessionUpdate({ sessionId: 'session-buf', update: update2 });

    const updateEmits = (events.emit as Mock).mock.calls.filter(
      (args: unknown[]) => args[0] === acpSessionUpdateChannel
    );
    expect(updateEmits).toHaveLength(2);

    const [e1, e2] = updateEmits.map(
      (args: unknown[]) => args[1] as { seq: number; turnId: string }
    );
    expect(e1.seq).toBe(0);
    expect(e2.seq).toBe(1);
    expect(e1.turnId).toBe(e2.turnId); // Same turn.
    expect(typeof e1.turnId).toBe('string');

    // Updates should be stored in the active turn via getChatHistory after commit.
    // (Turn is still active here since no prompt() resolved it.)
    const sessionState = manager.getSessionState('conv-buf');
    expect(sessionState.activeTurn?.updates).toHaveLength(2);
    expect(sessionState.activeTurn?.updates[0].seq).toBe(0);
    expect(sessionState.activeTurn?.updates[1].seq).toBe(1);
  });

  it('getChatHistory returns empty complete result for unknown conversation', () => {
    const manager = new AcpSessionManager();
    const history = manager.getChatHistory('no-such-conversation');
    expect(history).toEqual({ turns: [], complete: true });
  });
});
