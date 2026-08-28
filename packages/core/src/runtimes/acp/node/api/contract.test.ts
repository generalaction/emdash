import { isOk } from '@emdash/shared';
import { peek, remote, snapshot } from '@emdash/wire/state';
import { createTestWire } from '@emdash/wire/testing';
import { describe, expect, it, vi } from 'vitest';
import {
  acpApiContract,
  acpAttachmentErrorSchema,
  acpTerminateErrorSchema,
  acpRuntimeErrorSchema,
  historyPageSchema,
  sessionConfigStateSchema,
  sessionStateSchema,
  sessionUsageSchema,
  transcriptTurnSchema,
  uploadAttachmentCommandSchema,
} from '#runtimes/acp/api';
import { makeAcpHarness, makeStartInput } from '#runtimes/acp/node/acp-test-support';
import { AcpRuntime } from '#runtimes/acp/node/runtime/runtime';
import { createAcpController } from './controller';

describe('ACP API contract schemas', () => {
  it('parses runtime live model snapshots with the public schemas', async () => {
    const h = makeAcpHarness();
    const rt = new AcpRuntime(h.deps);
    const started = await rt.launchSession(makeStartInput({ conversationId: 'conv-contract' }));
    expect(isOk(started)).toBe(true);

    const live = rt.sessionLiveModels('conv-contract');
    if (!live) throw new Error('expected live models');

    expect(acpApiContract.session.id).toBe('session');
    expect(() => sessionStateSchema.parse(peek(live.states.state))).not.toThrow();
    expect(() => sessionConfigStateSchema.parse(peek(live.states.config))).not.toThrow();
    expect(() => sessionUsageSchema.nullable().parse(peek(live.states.usage))).not.toThrow();
    expect(() => transcriptTurnSchema.nullable().parse(peek(live.states.activeTurn))).not.toThrow();
  });

  it('round-trips procedures and live state over a wire transport', async () => {
    const h = makeAcpHarness();
    const rt = new AcpRuntime(h.deps);
    const wire = createTestWire(acpApiContract, createAcpController(rt));
    const contractClient = wire.client;
    const sessions = remote(acpApiContract.sessions, contractClient.sessions);
    const sessionRemote = remote(acpApiContract.session, contractClient.session);
    const summaries = sessions(undefined);

    try {
      await summaries.states.list.refresh();
      const input = makeStartInput({ conversationId: 'conv-wire' });
      const started = await contractClient.launch(input);
      expect(started).toEqual({ success: true, data: { sessionId: 'session-1' } });

      await vi.waitFor(() => {
        expect(snapshot(summaries.states.list).value?.['conv-wire']).toMatchObject({
          conversationId: 'conv-wire',
          lifecycle: 'ready',
        });
      });

      const session = sessionRemote({ conversationId: 'conv-wire' });
      await session.states.state.refresh();
      expect(snapshot(session.states.state).value).toMatchObject({ lifecycle: 'ready' });
    } finally {
      await sessions.dispose();
      await sessionRemote.dispose();
      wire.dispose();
    }
  });

  it('loads history through activation and keeps dormant settings non-waking', async () => {
    const h = makeAcpHarness({ lifecycle: { connectionIdleTtlMs: 0 } });
    const rt = new AcpRuntime(h.deps);
    const wire = createTestWire(acpApiContract, createAcpController(rt));
    const input = makeStartInput({ conversationId: 'conv-wire-suspended' });

    try {
      await wire.client.launch(input);
      await rt.stopSession(input.conversationId);
      h.agent.loadSession.mockClear();
      h.agent.newSession.mockClear();

      await expect(
        wire.client.loadHistory({
          conversationId: input.conversationId,
          limit: 50,
        })
      ).resolves.toMatchObject({
        success: true,
        data: { turns: [], nextCursor: null },
      });
      expect(h.agent.loadSession).toHaveBeenCalled();
      expect(h.agent.newSession).not.toHaveBeenCalled();

      await rt.stopSession(input.conversationId);

      h.agent.loadSession.mockRejectedValue(new Error('replay failed'));
      h.agent.newSession.mockRejectedValue(new Error('replacement failed'));

      await expect(
        wire.client.sendPrompt({
          conversationId: input.conversationId,
          prompt: { text: 'wake' },
        })
      ).resolves.toMatchObject({
        success: false,
        error: {
          type: 'prompt_failed',
          cause: { name: 'Error', message: 'replacement failed' },
        },
      });
      h.agent.loadSession.mockClear();
      h.agent.newSession.mockClear();
      await expect(
        wire.client.setOption({
          conversationId: input.conversationId,
          key: 'mode',
          value: 'agent',
        })
      ).resolves.toEqual({ success: true, data: undefined });
      await expect(
        wire.client.setOption({
          conversationId: input.conversationId,
          key: 'effort',
          value: 'high',
        })
      ).resolves.toEqual({ success: true, data: undefined });
      expect(h.agent.loadSession).not.toHaveBeenCalled();
      expect(h.agent.newSession).not.toHaveBeenCalled();
    } finally {
      wire.dispose();
    }
  });

  it('scopes attachment upload sidecar input to the owning conversation', () => {
    expect(uploadAttachmentCommandSchema.parse({ conversationId: 'conv-1' })).toEqual({
      conversationId: 'conv-1',
    });
    // Attachments are conversation-scoped (spec §3.6): the owning conversation is required.
    expect(() => uploadAttachmentCommandSchema.parse({})).toThrow();
  });

  it('accepts auth_required runtime errors', () => {
    expect(() =>
      acpRuntimeErrorSchema.parse({
        type: 'auth_required',
        cause: { name: 'RequestError', message: 'Authentication required' },
      })
    ).not.toThrow();
  });

  it('accepts typed durable intent failures from kill', () => {
    expect(() =>
      acpTerminateErrorSchema.parse({
        type: 'intent_persistence_failed',
        message: 'Failed to remove the durable session intent for conv-1',
        cause: { name: 'SessionIntentError', message: 'disk full' },
      })
    ).not.toThrow();
  });

  it('accepts typed attachment-not-found errors', () => {
    expect(() =>
      acpAttachmentErrorSchema.parse({
        type: 'attachment_not_found',
        message: "Attachment 'missing' not found",
      })
    ).not.toThrow();
  });

  it('accepts additive suspension and unavailable-history fields', () => {
    expect(() =>
      sessionStateSchema.parse({
        lifecycle: 'closed',
        suspended: true,
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
      })
    ).not.toThrow();
    expect(() =>
      historyPageSchema.parse({
        turns: [],
        nextCursor: null,
        unavailable: true,
      })
    ).not.toThrow();
  });
});
