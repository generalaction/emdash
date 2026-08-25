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
});
