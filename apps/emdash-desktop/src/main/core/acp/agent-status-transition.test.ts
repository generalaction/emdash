import type { SessionSummary } from '@emdash/core/runtimes/acp/api';
import { describe, expect, it } from 'vitest';
import { deriveAcpAgentStatusActions } from './agent-status-transition';

function summary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    conversationId: 'conv-1',
    providerId: 'claude',
    lifecycle: 'ready',
    isGenerating: false,
    lastStopReason: null,
    pendingPermissionCount: 0,
    backgroundAgentCount: 0,
    queuedPromptCount: 0,
    title: null,
    updatedAt: 1,
    ...overrides,
  };
}

describe('deriveAcpAgentStatusActions', () => {
  it('does not mark a plain starting session as working', () => {
    expect(deriveAcpAgentStatusActions(undefined, summary({ lifecycle: 'starting' }))).toEqual([]);
  });

  it('emits start when a queued prompt makes the session busy', () => {
    const actions = deriveAcpAgentStatusActions(
      undefined,
      summary({ lifecycle: 'starting', queuedPromptCount: 1 })
    );

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      kind: 'event',
      event: {
        type: 'start',
        providerId: 'claude',
        conversationId: 'conv-1',
      },
    });
  });

  it('emits start when generation begins', () => {
    const actions = deriveAcpAgentStatusActions(
      summary(),
      summary({ lifecycle: 'working', isGenerating: true })
    );

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ kind: 'event', event: { type: 'start' } });
  });

  it('emits an attention notification when a permission prompt appears', () => {
    const actions = deriveAcpAgentStatusActions(
      summary({ lifecycle: 'working', isGenerating: true }),
      summary({ lifecycle: 'working', isGenerating: true, pendingPermissionCount: 1 })
    );

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      kind: 'event',
      event: {
        type: 'notification',
        payload: { notificationType: 'permission_prompt' },
      },
    });
  });

  it('does not also emit start when a permission prompt is the first busy state', () => {
    const actions = deriveAcpAgentStatusActions(
      undefined,
      summary({ lifecycle: 'working', isGenerating: true, pendingPermissionCount: 1 })
    );

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ kind: 'event', event: { type: 'notification' } });
  });

  it('emits stop when busy work ends normally', () => {
    const actions = deriveAcpAgentStatusActions(
      summary({ lifecycle: 'working', isGenerating: true }),
      summary({ lifecycle: 'ready', lastStopReason: 'end_turn' })
    );

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ kind: 'event', event: { type: 'stop' } });
  });

  it('resets to idle when busy work is cancelled', () => {
    const actions = deriveAcpAgentStatusActions(
      summary({ lifecycle: 'cancelling', isGenerating: true }),
      summary({ lifecycle: 'ready', lastStopReason: 'cancelled' })
    );

    expect(actions).toEqual([
      {
        kind: 'reset',
        conversationId: 'conv-1',
      },
    ]);
  });

  it('resets to idle when a session is removed or closed', () => {
    expect(deriveAcpAgentStatusActions(summary(), undefined)).toEqual([
      {
        kind: 'reset',
        conversationId: 'conv-1',
      },
    ]);
    expect(deriveAcpAgentStatusActions(summary(), summary({ lifecycle: 'closed' }))).toEqual([
      {
        kind: 'reset',
        conversationId: 'conv-1',
      },
    ]);
  });
});
