import { isOk } from '@emdash/shared';
import { createManualClock } from '@emdash/shared/testing';
import { peek, remote, snapshot } from '@emdash/wire/state';
import { createTestWire } from '@emdash/wire/testing';
import { describe, expect, it, vi } from 'vitest';
import {
  acpApiContract,
  acpRuntimeErrorSchema,
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
    const started = await rt.startSession(makeStartInput({ conversationId: 'conv-contract' }));
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
      const started = await contractClient.start(input);
      expect(started).toEqual({
        success: true,
        data: { sessionId: 'session-1', activationId: expect.any(String) },
      });

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

  it('publishes idle eviction through an attached Wire projection and rematerializes atomically', async () => {
    const clock = createManualClock(0);
    const h = makeAcpHarness({
      clock,
      lifecycle: {
        session: { kind: 'idle-after', outputMs: 1_000 },
        sweepIntervalMs: 10_000,
      },
    });
    const rt = new AcpRuntime(h.deps);
    const wire = createTestWire(acpApiContract, createAcpController(rt));
    const sessionRemote = remote(acpApiContract.session, wire.client.session);
    const member = sessionRemote({ conversationId: 'conv-wire-idle' });
    const input = makeStartInput({ conversationId: 'conv-wire-idle' });

    try {
      await member.states.state.refresh();
      await member.states.activationId.refresh();
      expect(snapshot(member.states.state).value?.lifecycle).toBe('closed');

      const started = await wire.client.start(input);
      if (!started.success) throw new Error('expected ACP activation');
      await vi.waitFor(() => {
        expect(snapshot(member.states.state).value?.lifecycle).toBe('ready');
        expect(snapshot(member.states.activationId).value).toBe(started.data.activationId);
      });

      await clock.advanceBy(1_200);
      await rt.manager.sweepNow();
      await vi.waitFor(() => {
        expect(snapshot(member.states.state).value?.lifecycle).toBe('closed');
        expect(snapshot(member.states.activationId).value).toBeNull();
      });

      const history = await wire.client.getHistory({
        conversationId: input.conversationId,
        before: undefined,
        limit: 100,
        activation: input,
      });
      expect(history).toEqual({ success: true, data: { turns: [], nextCursor: null } });
      expect(h.agent.newSession).toHaveBeenCalledTimes(2);
      await vi.waitFor(() => expect(snapshot(member.states.state).value?.lifecycle).toBe('ready'));
    } finally {
      await sessionRemote.dispose();
      wire.dispose();
    }
  });

  it('reconnects a new Wire client to an inactive conversation', async () => {
    const h = makeAcpHarness();
    const rt = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'conv-wire-reconnect' });
    await rt.startSession(input);
    await rt.stopSession(input.conversationId);

    const wire = createTestWire(acpApiContract, createAcpController(rt));
    const sessionRemote = remote(acpApiContract.session, wire.client.session);
    const member = sessionRemote({ conversationId: input.conversationId });
    try {
      await member.states.state.refresh();
      expect(snapshot(member.states.state).value?.lifecycle).toBe('closed');

      h.agent.newSession.mockResolvedValueOnce({ sessionId: 'session-reconnected' });
      const history = await wire.client.getHistory({
        conversationId: input.conversationId,
        before: undefined,
        limit: 100,
        activation: input,
      });

      expect(history.success).toBe(true);
      await vi.waitFor(() => expect(snapshot(member.states.state).value?.lifecycle).toBe('ready'));
    } finally {
      await sessionRemote.dispose();
      wire.dispose();
    }
  });

  it('accepts attachment upload sidecar input with or without original path', () => {
    expect(() => uploadAttachmentCommandSchema.parse({ conversationId: 'conv-1' })).not.toThrow();
    expect(() =>
      uploadAttachmentCommandSchema.parse({
        conversationId: 'conv-1',
        originalPath: '/tmp/image.png',
      })
    ).not.toThrow();
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
});
