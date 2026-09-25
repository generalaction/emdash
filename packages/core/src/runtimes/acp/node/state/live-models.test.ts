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
        configured: {
          options: {
            model: 'sonnet',
            mode: 'agent-full-access',
            reasoning_effort: 'high',
          },
        },
        lastKnownCapabilities: {
          availableCommands: [],
          options: [
            {
              category: 'model',
              name: 'model',
              type: 'select',
              id: 'model',
              currentValue: 'sonnet',
              options: [
                {
                  value: 'sonnet',
                  name: 'Sonnet',
                },
              ],
            },
            {
              category: 'thought_level',
              name: 'thought_level',
              type: 'select',
              id: 'effort',
              currentValue: 'high',
              options: [
                {
                  value: 'high',
                  name: 'High',
                },
              ],
            },
            {
              category: 'mode',
              name: 'mode',
              type: 'select',
              id: 'mode',
              currentValue: 'agent-full-access',
              options: [
                {
                  value: 'agent-full-access',
                  name: 'Full access',
                },
              ],
            },
          ],
        },
        lastKnownMcpServers: [{ name: 'filesystem', transport: 'stdio' }],
        lastKnownUsage: { contextSize: 200000, contextUsed: 1000, cost: null },
        observedAt: 123,
      },
    });
    flushStateTurn();
    expect(peek(projection.states.config)).toMatchObject({
      options: [
        {
          category: 'model',
          currentValue: 'sonnet',
        },
        {
          category: 'thought_level',
          currentValue: 'high',
        },
        {
          category: 'mode',
          currentValue: 'agent-full-access',
        },
      ],
    });
    expect(peek(projection.states.mcpServers)).toEqual([
      { name: 'filesystem', transport: 'stdio' },
    ]);
    expect(peek(projection.states.usage)).toEqual({
      contextSize: 200000,
      contextUsed: 1000,
      cost: null,
    });
    await host.dispose();
  });
});
