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
    session: conversationsContract.acp.session,
  }),
});

describe('ACP attachment recovery over replaceable Wire', () => {
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

function peer(model: string, attachGate: Promise<void> = Promise.resolve()) {
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
    mcpServers: cell([]),
  });
  const controller = createController(contract, {
    acp: {
      attach: async () => {
        await attachGate;
        return ok();
      },
      session,
    },
  });
  const hub = createWireSessionHub(controller);
  const pair = memoryTransportPair();
  hub.open('client', pair.right);
  return {
    transport: pair.left,
    dispose: async () => {
      await hub.dispose();
      await session.dispose();
    },
  };
}
