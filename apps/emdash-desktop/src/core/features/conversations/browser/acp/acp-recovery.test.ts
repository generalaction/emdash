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
import { cell, expose } from '@emdash/wire/state';
import { describe, expect, it, vi } from 'vitest';
import { conversationsContract } from '../../api';
import { AcpLiveSession } from './acp-live-session';

const getClient = vi.hoisted(() => vi.fn());
vi.mock('@core/features/conversations/api/browser/client', () => ({
  getConversationsClient: getClient,
}));

const contract = defineContract({
  acp: defineContract({
    attach: conversationsContract.acp.attach,
    startSession: conversationsContract.acp.startSession,
    session: conversationsContract.acp.session,
  }),
});

describe('ACP attachment recovery over replaceable Wire', () => {
  it.each([null, 'saved'])(
    'uses the shared start operation after attaching session %s',
    async (sessionId) => {
      const transport = replaceableTransport();
      const connection = connect(transport, { maxHeldCalls: 0 });
      getClient.mockResolvedValue(client(contract, connection));
      const runtime = peer('model', Promise.resolve(), async () => {}, sessionId);
      transport.install(runtime.transport);
      const session = await AcpLiveSession.create('conversation');
      try {
        expect(runtime.startSession).not.toHaveBeenCalled();
        await session.startSession();
        expect(runtime.startSession.mock.calls[0]?.[0]).toEqual({
          conversationId: 'conversation',
          mode: sessionId ? 'resume' : 'fresh',
        });
        await session.startSession('fresh');
        expect(runtime.startSession.mock.calls[1]?.[0]).toEqual({
          conversationId: 'conversation',
          mode: 'fresh',
        });
        await session.startSession();
        expect(runtime.startSession.mock.calls[2]?.[0]).toEqual({
          conversationId: 'conversation',
          mode: 'resume',
        });
      } finally {
        session.dispose();
        connection.dispose();
        transport.close();
        await runtime.dispose();
      }
    }
  );

  it.each(['cancel', 'dispose'] as const)(
    'does not restore usability after %s during attachment',
    async (action) => {
      const transport = replaceableTransport();
      const connection = connect(transport, { maxHeldCalls: 0 });
      getClient.mockResolvedValue(client(contract, connection));
      const first = peer('old');
      const gate = deferred<void>();
      const replacement = peer('new', gate.promise);
      transport.install(first.transport);
      const session = await AcpLiveSession.create('conversation');
      try {
        transport.detach();
        transport.install(replacement.transport);
        const controller = new AbortController();
        const recovery = session.revalidate(action === 'cancel' ? controller.signal : undefined);
        const settled = recovery.catch(() => {});
        if (action === 'cancel') controller.abort();
        else session.dispose();
        await settled;
        gate.resolve();
        await Promise.resolve();
        expect(session.usable).toBe(false);
      } finally {
        gate.resolve();
        session.dispose();
        connection.dispose();
        transport.close();
        await first.dispose();
        await replacement.dispose();
      }
    }
  );
  it('requires a successful reattach before restoring usability after a timeout', async () => {
    vi.useFakeTimers();
    const transport = replaceableTransport();
    const connection = connect(transport, { maxHeldCalls: 0 });
    const rpc = client(contract, connection);
    getClient.mockResolvedValue(rpc);
    const first = peer('old');
    const gate = deferred<void>();
    const replacement = peer('new', gate.promise);
    transport.install(first.transport);
    const session = await AcpLiveSession.create('conversation');
    try {
      transport.detach();
      transport.install(replacement.transport);
      const recovery = expect(session.revalidate()).rejects.toThrow(
        'Timed out reattaching ACP session'
      );
      await vi.advanceTimersByTimeAsync(10_000);
      await recovery;
      expect(session.usable).toBe(false);
      gate.resolve();
      await vi.advanceTimersByTimeAsync(0);
      await expect(rpc.acp.attach({ conversationId: 'conversation' })).resolves.toEqual(
        ok({ sessionId: 'session-1' })
      );
      await vi.advanceTimersByTimeAsync(60_000);
      expect(session.config.current().modelOptions?.selected).toBe('new');
      expect(session.usable).toBe(false);
      await session.revalidate();
      expect(session.usable).toBe(true);
    } finally {
      gate.resolve();
      session.dispose();
      transport.close();
      connection.dispose();
      await first.dispose();
      await replacement.dispose();
      vi.useRealTimers();
    }
  });

  it('recovers optional metadata after its initial acquisition fails without blocking chat', async () => {
    const transport = replaceableTransport();
    const connection = connect(transport, { maxHeldCalls: 0 });
    getClient.mockResolvedValue(client(contract, connection));
    const first = peer('old', Promise.resolve(), async () => {
      throw new Error('MCP metadata unavailable');
    });
    const replacement = peer('new');
    transport.install(first.transport);
    const session = await AcpLiveSession.create('conversation');
    try {
      expect(session.usable).toBe(true);
      expect(session.mcpServers.current()).toEqual([]);
      transport.detach();
      transport.install(replacement.transport);
      await session.revalidate();
      expect(session.usable).toBe(true);
      await vi.waitFor(() => expect(session.mcpServers.current()).toEqual([{ name: 'new' }]));
    } finally {
      session.dispose();
      transport.close();
      connection.dispose();
      await first.dispose();
      await replacement.dispose();
    }
  });

  it('retains the logical session while reattaching and refreshing daemon-owned state', async () => {
    const transport = replaceableTransport();
    const connection = connect(transport, { maxHeldCalls: 0 });
    getClient.mockResolvedValue(client(contract, connection));
    const first = peer('old');
    const gate = deferred<void>();
    const replacement = peer('new', gate.promise);
    transport.install(first.transport);
    const session = await AcpLiveSession.create('conversation');
    try {
      expect(session.usable).toBe(true);
      expect(session.config.current().modelOptions?.selected).toBe('old');
      transport.detach();
      expect(session.config.current().modelOptions?.selected).toBe('old');
      transport.install(replacement.transport);
      const recovery = session.revalidate();
      expect(session.usable).toBe(false);
      gate.resolve();
      await recovery;
      expect(session.usable).toBe(true);
      expect(session.conversationId).toBe('conversation');
      expect(session.config.current().modelOptions?.selected).toBe('new');
    } finally {
      gate.resolve();
      session.dispose();
      transport.close();
      connection.dispose();
      await first.dispose();
      await replacement.dispose();
    }
  });
});

function peer(
  model: string,
  attachGate: Promise<void> = Promise.resolve(),
  loadMetadata: () => Promise<void> = async () => {},
  sessionId: string | null = 'session-1'
) {
  const session = expose(contract.acp.session, {
    state: cell({
      lifecycle: 'ready' as const,
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
    }),
    config: cell({
      modelOptions: { configId: 'model', selected: model, available: [] },
      efforts: null,
      modeOptions: null,
      availableCommands: [],
    }),
    usage: cell(null),
    plan: cell(null),
    agents: cell([]),
    activeTurn: cell(null),
    terminals: cell([]),
    mcpServers: async () => {
      await loadMetadata();
      return cell([{ name: model }]);
    },
  });
  const startSession = vi.fn(async (_input: { conversationId: string; mode: 'resume' | 'fresh' }) =>
    ok({ sessionId: 'session-1' })
  );
  const controller = createController(contract, {
    acp: {
      attach: async () => {
        await attachGate;
        return ok({ sessionId });
      },
      startSession,
      session,
    },
  });
  const hub = createWireSessionHub(controller);
  const pair = memoryTransportPair();
  hub.open('client', pair.right);
  return {
    transport: pair.left,
    startSession,
    dispose: async () => {
      await hub.dispose();
      await session.dispose();
    },
  };
}
