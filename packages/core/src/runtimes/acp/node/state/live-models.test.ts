import { flushStateTurn, peek } from '@emdash/wire/state';
import { describe, expect, it } from 'vitest';
import { initialSessionConfigState } from '#runtimes/acp/api';
import { closedSessionState, createAcpSessionLiveHost } from './live-models';

describe('ACP live models', () => {
  it('derives closed, suspended, and active slices from one explicit source', async () => {
    const host = createAcpSessionLiveHost();
    const projection = host.models('conversation-1');

    expect(peek(projection.states.state)).toBe(closedSessionState);

    projection.source.set({ kind: 'suspended' });
    flushStateTurn();

    expect(peek(projection.states.state)).toMatchObject({
      lifecycle: 'closed',
      suspended: true,
      canSubmit: true,
      pendingPermissions: [],
      queuedPrompts: [],
    });

    projection.source.set({
      kind: 'active',
      snapshot: {
        state: { ...closedSessionState, lifecycle: 'ready', canSubmit: true },
        config: initialSessionConfigState,
        usage: null,
        plan: null,
        agents: [],
        activeTurn: null,
        terminals: [],
        mcpServers: [],
      },
    });
    flushStateTurn();

    expect(peek(projection.states.state)).toMatchObject({ lifecycle: 'ready', canSubmit: true });

    projection.source.set({ kind: 'closed' });
    flushStateTurn();

    expect(peek(projection.states.state)).toBe(closedSessionState);
    await host.dispose();
  });

  it('keeps retained config, MCP servers, and usage visible while suspended', async () => {
    const host = createAcpSessionLiveHost();
    const projection = host.models('conversation-retained');

    projection.source.set({
      kind: 'suspended',
      retained: {
        configured: { model: 'sonnet', modeId: 'agent-full-access', effort: 'high' },
        lastKnownCapabilities: {
          modelOptions: {
            configId: 'model',
            selected: 'sonnet',
            available: [{ id: 'sonnet', name: 'Sonnet' }],
          },
          efforts: {
            configId: 'effort',
            selected: 'high',
            available: [{ id: 'high', name: 'High' }],
          },
          modeOptions: {
            configId: 'mode',
            selected: 'agent-full-access',
            available: [{ id: 'agent-full-access', name: 'Full access' }],
          },
          availableCommands: [],
        },
        lastKnownMcpServers: [{ name: 'filesystem', transport: 'stdio' }],
        lastKnownUsage: { contextSize: 200_000, contextUsed: 1_000, cost: null },
        observedAt: 123,
      },
    });
    flushStateTurn();

    expect(peek(projection.states.config)).toMatchObject({
      modelOptions: { selected: 'sonnet' },
      efforts: { selected: 'high' },
      modeOptions: { selected: 'agent-full-access' },
    });
    expect(peek(projection.states.mcpServers)).toEqual([
      { name: 'filesystem', transport: 'stdio' },
    ]);
    expect(peek(projection.states.usage)).toEqual({
      contextSize: 200_000,
      contextUsed: 1_000,
      cost: null,
    });
    await host.dispose();
  });
});
