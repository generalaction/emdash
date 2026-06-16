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
  setProviderSessionId: vi.fn().mockResolvedValue(true), // writes to conversations.sessionId
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

    // First conversation creates the pool.
    (mockConnection.newSession as Mock)
      .mockResolvedValueOnce({ sessionId: 'session-a' })
      .mockResolvedValueOnce({ sessionId: 'session-b' });

    await manager.start(convA, 'ws-1', '/tmp/workspace');
    await manager.start(convB, 'ws-1', '/tmp/workspace');

    // spawn should have been called exactly once.
    expect(spawn).toHaveBeenCalledTimes(1);
    // newSession should have been called once per conversation.
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

  it('sessionUpdate routes to the correct conversationId without cross-talk', async () => {
    const { events } = await import('@main/lib/events');
    const { acpSessionUpdateChannel } = await import('@shared/core/acp/acpEvents');

    (events.emit as Mock).mockReset();

    const manager = new AcpSessionManager();

    (mockConnection.newSession as Mock)
      .mockResolvedValueOnce({ sessionId: 'session-a' })
      .mockResolvedValueOnce({ sessionId: 'session-b' });

    await manager.start(makeConversation({ conversationId: 'conv-a' }), 'ws-1', '/tmp/workspace');
    await manager.start(makeConversation({ conversationId: 'conv-b' }), 'ws-1', '/tmp/workspace');

    // Get the handler that was registered with the pool.
    expect(capturedHandlerFactory).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = capturedHandlerFactory!(null) as any;

    // Reset emit so we only count the routing calls.
    (events.emit as Mock).mockReset();

    // Simulate an update arriving for session-b.
    await handler.sessionUpdate({
      sessionId: 'session-b',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello' } },
    });

    expect(events.emit).toHaveBeenCalledTimes(1);
    expect(events.emit).toHaveBeenCalledWith(acpSessionUpdateChannel, {
      conversationId: 'conv-b',
      update: expect.objectContaining({ sessionUpdate: 'agent_message_chunk' }),
    });
  });

  it('reconnecting with an existing providerSessionId calls loadSession and emits replay events', async () => {
    const { events } = await import('@main/lib/events');
    const { acpSessionReplayChannel } = await import('@shared/core/acp/acpEvents');

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

    const replayCalls = (events.emit as Mock).mock.calls.filter(
      (args: unknown[]) => args[0] === acpSessionReplayChannel
    );
    expect(replayCalls).toHaveLength(2);
    expect(replayCalls[0][1]).toMatchObject({ conversationId: 'conv-replay', phase: 'start' });
    expect(replayCalls[1][1]).toMatchObject({ conversationId: 'conv-replay', phase: 'end' });
  });

  it('falls back to newSession when loadSession throws and emits replay-end to close the reset', async () => {
    const { events } = await import('@main/lib/events');
    const { acpSessionReplayChannel } = await import('@shared/core/acp/acpEvents');

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

    const replayCalls = (events.emit as Mock).mock.calls.filter(
      (args: unknown[]) => args[0] === acpSessionReplayChannel
    );
    // Both start and end must be emitted even on loadSession failure.
    expect(replayCalls).toHaveLength(2);
    expect(replayCalls[0][1]).toMatchObject({ phase: 'start' });
    expect(replayCalls[1][1]).toMatchObject({ phase: 'end' });
  });

  it('sessionUpdate for unknown sessionId does not emit an event', async () => {
    const { events } = await import('@main/lib/events');

    (events.emit as Mock).mockReset();

    const manager = new AcpSessionManager();

    (mockConnection.newSession as Mock).mockResolvedValue({ sessionId: 'session-a' });
    await manager.start(makeConversation({ conversationId: 'conv-a' }), 'ws-1', '/tmp/workspace');

    expect(capturedHandlerFactory).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = capturedHandlerFactory!(null) as any;

    (events.emit as Mock).mockReset();

    // Unknown session id — should not route.
    await handler.sessionUpdate({
      sessionId: 'unknown-session-xyz',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ghost' } },
    });

    // Only the acpSessionUpdateChannel emit should NOT happen (events.emit may
    // still be called for agent events, but acpSessionUpdateChannel should be
    // absent).
    const acpEmits = (events.emit as Mock).mock.calls.filter(
      (args: unknown[]) => args[0] === 'acp:session-update'
    );
    expect(acpEmits).toHaveLength(0);
  });
});
