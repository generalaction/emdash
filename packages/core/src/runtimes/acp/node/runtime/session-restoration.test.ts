import { deferred } from '@emdash/shared/testing';
import { peek } from '@emdash/wire/state';
import { describe, expect, it, vi } from 'vitest';
import { makeAcpHarness, makeStartInput } from '#runtimes/acp/node/acp-test-support';
import { createMemorySessionIntentStore } from '#services/session-intents/api';
import { AcpRuntime } from './runtime';

describe('ACP restoration continuity', () => {
  it('does not replace a saved conversation when the provider cannot load sessions', async () => {
    const h = makeAcpHarness();
    h.agent.initialize.mockResolvedValueOnce({ protocolVersion: 1, agentCapabilities: {} });
    const runtime = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'unsupported-replay', sessionId: 'original' });
    try {
      await runtime.attachSession(input);
      expect((await runtime.loadHistory(input.conversationId)).success).toBe(false);
      expect(h.agent.newSession).not.toHaveBeenCalled();
      expect(h.agent.loadSession).not.toHaveBeenCalled();
    } finally {
      await runtime.dispose();
    }
  });

  it('retries a rejected close before retrying restoration', async () => {
    const h = makeAcpHarness();
    const runtime = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'retry-close' });
    await runtime.launchSession(input);
    h.agent.closeSession.mockRejectedValueOnce(new Error('temporarily unavailable'));
    try {
      await runtime.stopSession(input.conversationId);
      expect((await runtime.loadHistory(input.conversationId)).success).toBe(true);
      expect(h.agent.closeSession).toHaveBeenCalledTimes(2);
      expect(h.agent.loadSession).toHaveBeenCalledOnce();
      expect(h.agent.newSession).toHaveBeenCalledOnce();
    } finally {
      await runtime.dispose();
    }
  });

  it('does not persist a rebound session id from a replay that subsequently fails', async () => {
    const intents = createMemorySessionIntentStore();
    const h = makeAcpHarness({ intents });
    const runtime = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'failed-rebind', sessionId: 'original' });
    h.agent.loadSession.mockImplementationOnce(async () => {
      await h.client().sessionUpdate({
        sessionId: 'provisional-id',
        update: {
          sessionUpdate: 'user_message_chunk',
          content: { type: 'text', text: 'Partial history' },
        },
      });
      throw new Error('replay failed');
    });
    try {
      await runtime.attachSession(input);
      expect((await runtime.loadHistory(input.conversationId)).success).toBe(false);
      expect(intents.snapshot()[0]?.sessionId).toBe('original');
      expect((await runtime.loadHistory(input.conversationId)).success).toBe(true);
      expect(h.agent.loadSession).toHaveBeenLastCalledWith(
        expect.objectContaining({ sessionId: 'original' })
      );
    } finally {
      await runtime.dispose();
    }
  });

  it('waits for the provider close acknowledgement before resuming', async () => {
    const h = makeAcpHarness();
    const runtime = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'close-before-resume' });
    const closed = deferred<void>();
    await runtime.launchSession(input);
    h.agent.closeSession.mockImplementationOnce(() => closed.promise);
    const stopping = runtime.stopSession(input.conversationId);
    await vi.waitFor(() => expect(h.agent.closeSession).toHaveBeenCalledOnce());
    const loading = runtime.loadHistory(input.conversationId);
    try {
      // Allow the competing wake to reach materialization while close is held.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(h.agent.loadSession).not.toHaveBeenCalled();
    } finally {
      closed.resolve();
      await stopping;
      await loading;
      await runtime.dispose();
    }
    expect(h.agent.loadSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-1' })
    );
  });

  it('bounds a stuck close and rejects restoration until that close completes', async () => {
    const h = makeAcpHarness({ lifecycle: { activationDrainTimeoutMs: 20 } });
    const runtime = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'close-timeout' });
    const closed = deferred<void>();
    await runtime.launchSession(input);
    h.agent.closeSession.mockImplementationOnce(() => closed.promise);
    try {
      await runtime.stopSession(input.conversationId);
      const failed = await runtime.loadHistory(input.conversationId);
      expect(failed.success).toBe(false);
      expect(h.agent.loadSession).not.toHaveBeenCalled();
      expect(h.agent.newSession).toHaveBeenCalledOnce();
      expect(h.agent.closeSession).toHaveBeenCalledOnce();
      closed.resolve();
      expect((await runtime.loadHistory(input.conversationId)).success).toBe(true);
      expect(h.agent.loadSession).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'session-1' })
      );
    } finally {
      closed.resolve();
      await runtime.dispose();
    }
  });

  it('allows a new provider generation to restore after the old process dies during close', async () => {
    const h = makeAcpHarness({ lifecycle: { activationDrainTimeoutMs: 20 } });
    const runtime = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'close-process-exited' });
    const closed = deferred<void>();
    await runtime.launchSession(input);
    h.agent.closeSession.mockImplementationOnce(() => closed.promise);
    try {
      await runtime.stopSession(input.conversationId);
      h.lastChild.emitExit(42);
      await vi.waitFor(() =>
        expect(
          runtime.connections.peek({ providerId: input.providerId, cwd: input.cwd })
        ).toBeUndefined()
      );
      expect((await runtime.loadHistory(input.conversationId)).success).toBe(true);
      expect(h.children).toHaveLength(2);
      expect(h.agent.loadSession).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'session-1' })
      );
    } finally {
      closed.resolve();
      await runtime.dispose();
    }
  });

  it('keeps the original session identity and allows retry after a load failure', async () => {
    const intents = createMemorySessionIntentStore();
    const h = makeAcpHarness({ intents });
    const runtime = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'retry-original', sessionId: 'original' });
    await runtime.attachSession(input);
    h.agent.loadSession.mockRejectedValueOnce(new Error('Session original is closing'));
    try {
      expect((await runtime.loadHistory(input.conversationId)).success).toBe(false);
      expect(h.agent.newSession).not.toHaveBeenCalled();
      expect(intents.snapshot()[0]?.sessionId).toBe('original');
      expect((await runtime.loadHistory(input.conversationId)).success).toBe(true);
      expect(h.agent.loadSession).toHaveBeenLastCalledWith(
        expect.objectContaining({ sessionId: 'original' })
      );
    } finally {
      await runtime.dispose();
    }
  });

  it('keeps replayed turns out of the live projection until history is complete', async () => {
    const h = makeAcpHarness();
    const runtime = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'replay-is-history', sessionId: 'original' });
    const replayed = deferred<void>();
    const finish = deferred<void>();
    h.agent.loadSession.mockImplementationOnce(async () => {
      await h.client().sessionUpdate({
        sessionId: 'original',
        update: {
          sessionUpdate: 'user_message_chunk',
          content: { type: 'text', text: 'Existing message' },
        },
      });
      replayed.resolve();
      await finish.promise;
      return {};
    });
    await runtime.attachSession(input);
    const loading = runtime.loadHistory(input.conversationId);
    try {
      await replayed.promise;
      const live = runtime.sessionLiveModels(input.conversationId)!;
      expect(peek(live.states.state)?.lifecycle).toBe('replaying');
      expect(peek(live.states.activeTurn)).toBeNull();
    } finally {
      finish.resolve();
      const loaded = await loading;
      expect(loaded).toMatchObject({
        success: true,
        data: {
          turns: [
            expect.objectContaining({
              items: [expect.objectContaining({ text: 'Existing message' })],
            }),
          ],
        },
      });
      await runtime.dispose();
    }
  });
});
