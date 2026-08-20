import { flushStateTurn, peek } from '@emdash/wire/state';
import { describe, expect, it } from 'vitest';
import { initialSessionConfigState } from '#runtimes/acp/api';
import { createAcpSessionLiveHost, inactiveSessionState } from './live-models';

describe('ACP live models', () => {
  it('derives every exposed state from one activation snapshot', async () => {
    const host = createAcpSessionLiveHost();
    const projection = host.models('conversation-1');

    expect(peek(projection.states.state)).toBe(inactiveSessionState);
    const inactiveAgents = peek(projection.states.agents);

    projection.source.set({
      activationId: 'activation-1',
      state: { ...inactiveSessionState, lifecycle: 'ready', canSubmit: true },
      config: initialSessionConfigState,
      usage: null,
      plan: null,
      agents: [],
      activeTurn: null,
      terminals: [],
      mcpServers: [],
    });
    flushStateTurn();

    expect(peek(projection.states.activationId)).toBe('activation-1');
    expect(peek(projection.states.state)).toMatchObject({ lifecycle: 'ready', canSubmit: true });

    projection.source.set(null);
    flushStateTurn();

    expect(peek(projection.states.activationId)).toBeNull();
    expect(peek(projection.states.state)).toBe(inactiveSessionState);
    expect(peek(projection.states.agents)).toBe(inactiveAgents);
    await host.dispose();
  });
});
