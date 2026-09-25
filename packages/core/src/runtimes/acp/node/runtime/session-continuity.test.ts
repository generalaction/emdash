import { err, type Serializable } from '@emdash/shared';
import { deferred } from '@emdash/shared/testing';
import { describe, expect, it, vi } from 'vitest';
import { makeAcpHarness, makeStartInput } from '#runtimes/acp/node/acp-test-support';
import { createMemorySessionIntentStore } from '#services/session-intents/api';
import { AcpRuntime } from './runtime';

describe('ACP session continuity', () => {
  it('observes without starting and uses one explicit start operation for new and resumed sessions', async () => {
    const h = makeAcpHarness();
    const runtime = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'explicit-start' });
    try {
      expect(await runtime.attachSession(input)).toMatchObject({
        success: true,
        data: { sessionId: null },
      });
      expect(await runtime.loadHistory(input.conversationId)).toMatchObject({
        success: true,
        data: { unavailable: true },
      });
      expect(h.agent.newSession).not.toHaveBeenCalled();
      expect(h.agent.loadSession).not.toHaveBeenCalled();
      expect((await runtime.startSession(input, 'fresh')).success).toBe(true);
      await runtime.stopSession(input.conversationId);
      expect(await runtime.loadHistory(input.conversationId)).toMatchObject({
        success: true,
        data: { unavailable: true },
      });
      expect(h.agent.loadSession).not.toHaveBeenCalled();
      expect(await runtime.attachSession(input)).toMatchObject({
        success: true,
        data: { sessionId: 'session-1' },
      });
      expect((await runtime.startSession(input, 'resume')).success).toBe(true);
      expect(h.agent.loadSession).toHaveBeenCalledOnce();
      expect(h.agent.newSession).toHaveBeenCalledOnce();
    } finally {
      await runtime.dispose();
    }
  });

  it('starts a fresh provider session in the same conversation without resuming again', async () => {
    const intents = createMemorySessionIntentStore();
    const h = makeAcpHarness({ intents });
    let runtime = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'legacy-empty', sessionId: 'missing' });
    h.agent.loadSession.mockRejectedValueOnce(
      Object.assign(new Error('Resource not found'), { code: -32002, data: { uri: 'missing' } })
    );
    try {
      await runtime.attachSession(input);
      expect(await runtime.startSession(input, 'resume')).toMatchObject({
        success: false,
        error: { type: 'session_not_found' },
      });
      expect((await runtime.startSession(input, 'fresh')).success).toBe(true);
      expect((await startAndLoadHistory(runtime, input)).success).toBe(true);
      expect(h.agent.loadSession).toHaveBeenCalledOnce();
      expect(h.agent.newSession).toHaveBeenCalledOnce();
      expect(h.agent.prompt).not.toHaveBeenCalled();
      expect(intents.snapshot()).toMatchObject([
        {
          conversationId: input.conversationId,
          sessionId: 'session-1',
          payload: { unstarted: true },
        },
      ]);
      await runtime.dispose();
      runtime = new AcpRuntime(h.deps);
      await runtime.reconcile();
      // The desktop's pointer can lag the authoritative runtime intent.
      await runtime.attachSession(input);
      expect((await startAndLoadHistory(runtime, input)).success).toBe(true);
      expect(h.agent.loadSession).toHaveBeenLastCalledWith(
        expect.objectContaining({ sessionId: 'session-1' })
      );
      expect(h.agent.newSession).toHaveBeenCalledOnce();
    } finally {
      await runtime.dispose();
    }
  });

  it('preserves the saved pointer if an explicit fresh start fails and coalesces another attempt', async () => {
    const intents = createMemorySessionIntentStore();
    const h = makeAcpHarness({ intents });
    const runtime = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'fresh-failure', sessionId: 'saved' });
    h.agent.newSession.mockRejectedValueOnce(new Error('provider unavailable'));
    try {
      expect((await runtime.startSession(input, 'fresh')).success).toBe(false);
      expect(intents.snapshot()[0]?.sessionId).toBe('saved');
      expect(h.agent.loadSession).not.toHaveBeenCalled();
      const results = await Promise.all([
        runtime.startSession(input, 'fresh'),
        runtime.startSession(input, 'fresh'),
      ]);
      expect(results.every((result) => result.success)).toBe(true);
      expect(h.agent.newSession).toHaveBeenCalledTimes(2);
      expect(h.agent.loadSession).not.toHaveBeenCalled();
      expect((await runtime.startSession(input, 'fresh')).success).toBe(false);
      expect(runtime.getSessionState(input.conversationId).lifecycle).toBe('ready');
      expect(h.agent.newSession).toHaveBeenCalledTimes(2);
    } finally {
      await runtime.dispose();
    }
  });

  it('rejects a fresh request during resume without interrupting the existing activation', async () => {
    const h = makeAcpHarness();
    const runtime = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'concurrent-resume' });
    const loaded = deferred<Awaited<ReturnType<typeof h.agent.loadSession>>>();
    try {
      await runtime.startSession(input, 'fresh');
      await runtime.stopSession(input.conversationId);
      h.agent.loadSession.mockImplementationOnce(() => loaded.promise);
      const resuming = runtime.startSession(input, 'resume');
      await vi.waitFor(() => expect(h.agent.loadSession).toHaveBeenCalledOnce());
      expect(await runtime.startSession(input, 'fresh')).toMatchObject({
        success: false,
        error: { type: 'invalid_state' },
      });
      expect(runtime.getSessionState(input.conversationId).lifecycle).toBe('replaying');
      loaded.resolve({});
      expect((await resuming).success).toBe(true);
      expect(h.agent.newSession).toHaveBeenCalledOnce();
    } finally {
      loaded.resolve({});
      await runtime.dispose();
    }
  });

  it('keeps an untouched conversation recoverable after a successful empty replay', async () => {
    const h = makeAcpHarness();
    const runtime = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'empty-replay' });
    try {
      await runtime.startSession(input, 'resume');
      await runtime.stopSession(input.conversationId);
      expect((await startAndLoadHistory(runtime, input)).success).toBe(true);
      await runtime.stopSession(input.conversationId);
      h.agent.loadSession.mockRejectedValueOnce(
        Object.assign(new Error('Resource not found'), { code: -32002, data: { uri: 'session-1' } })
      );
      expect((await startAndLoadHistory(runtime, input)).success).toBe(true);
      expect(h.agent.newSession).toHaveBeenCalledTimes(2);
    } finally {
      await runtime.dispose();
    }
  });

  it.each([
    { name: 'another resource', code: -32002, data: { uri: '/missing/file' } },
    { name: 'an internal failure', code: -32603, data: { details: 'permission denied' } },
  ])('does not replace an untouched session after $name', async ({ code, data }) => {
    const h = makeAcpHarness();
    const runtime = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'uncertain-restore' });
    try {
      await runtime.startSession(input, 'resume');
      await runtime.stopSession(input.conversationId);
      h.agent.loadSession.mockRejectedValueOnce(
        Object.assign(new Error('Could not load'), { code, data })
      );
      expect(await startAndLoadHistory(runtime, input)).toMatchObject({
        success: false,
        error: { type: 'invalid_state' },
      });
      expect(h.agent.newSession).toHaveBeenCalledOnce();
      expect((await startAndLoadHistory(runtime, input)).success).toBe(true);
    } finally {
      await runtime.dispose();
    }
  });

  it('retains evidence of partial replay even when loading later reports a missing session', async () => {
    const intents = createMemorySessionIntentStore();
    const h = makeAcpHarness({ intents });
    let runtime = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'partial-history' });
    const missing = Object.assign(new Error('Resource not found: session-1'), {
      code: -32002,
      data: { uri: 'session-1' },
    });
    try {
      await runtime.startSession(input, 'resume');
      await runtime.stopSession(input.conversationId);
      h.agent.loadSession.mockImplementationOnce(async () => {
        await h.client().sessionUpdate({
          sessionId: 'session-1',
          update: {
            sessionUpdate: 'user_message_chunk',
            content: { type: 'text', text: 'Existing history' },
          },
        });
        throw missing;
      });
      expect(await startAndLoadHistory(runtime, input)).toMatchObject({
        success: false,
        error: { type: 'session_not_found' },
      });
      expect(intents.snapshot()[0]?.payload).toMatchObject({ unstarted: false });
      await runtime.dispose();
      runtime = new AcpRuntime(h.deps);
      await runtime.reconcile();
      await runtime.attachSession({ ...input, sessionId: 'session-1' });
      h.agent.loadSession.mockRejectedValueOnce(missing);
      expect(await startAndLoadHistory(runtime, input)).toMatchObject({
        success: false,
        error: { type: 'session_not_found' },
      });
      expect(h.agent.newSession).toHaveBeenCalledOnce();
    } finally {
      await runtime.dispose();
    }
  });
  it.each(['suspension', 'worker restart'] as const)(
    'keeps an untouched conversation usable after %s',
    async (cause) => {
      const intents = createMemorySessionIntentStore();
      const h = makeAcpHarness({ intents });
      let runtime = new AcpRuntime(h.deps);
      const input = makeStartInput({ conversationId: 'untouched' });
      h.agent.newSession
        .mockResolvedValueOnce({ sessionId: 'unsaved' })
        .mockResolvedValueOnce({ sessionId: 'replacement' });
      h.agent.loadSession.mockRejectedValue(
        Object.assign(new Error('Resource not found'), { code: -32002, data: { uri: 'unsaved' } })
      );
      try {
        await runtime.attachSession(input);
        expect((await startAndLoadHistory(runtime, input)).success).toBe(true);
        await runtime.stopSession(input.conversationId);
        if (cause === 'worker restart') {
          await runtime.dispose();
          runtime = new AcpRuntime(h.deps);
          await runtime.reconcile();
        }
        await runtime.attachSession({ ...input, sessionId: 'unsaved' });
        expect((await startAndLoadHistory(runtime, input)).success).toBe(true);
        expect(h.agent.loadSession).toHaveBeenCalledOnce();
        expect(h.agent.newSession).toHaveBeenCalledTimes(2);
        expect(intents.snapshot()[0]).toMatchObject({
          conversationId: input.conversationId,
          sessionId: 'replacement',
          payload: { unstarted: true },
        });
      } finally {
        await runtime.dispose();
      }
    }
  );

  it('requires restoration after the first prompt, including after a worker restart', async () => {
    const intents = createMemorySessionIntentStore();
    const h = makeAcpHarness({ intents });
    let runtime = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'used' });
    try {
      await runtime.startSession(input, 'resume');
      h.agent.prompt.mockImplementation(async () => {
        expect(intents.snapshot()[0]).toMatchObject({
          sessionId: 'session-1',
          payload: { unstarted: false },
        });
        return { stopReason: 'end_turn' };
      });
      expect((await runtime.sendPrompt(input.conversationId, { text: 'hello' })).success).toBe(
        true
      );
      await vi.waitFor(() => expect(h.agent.prompt).toHaveBeenCalledOnce());
      await runtime.dispose();
      runtime = new AcpRuntime(h.deps);
      await runtime.reconcile();
      await runtime.attachSession({ ...input, sessionId: 'session-1' });
      expect((await startAndLoadHistory(runtime, input)).success).toBe(true);
      expect(h.agent.loadSession).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'session-1' })
      );
      expect(h.agent.newSession).toHaveBeenCalledOnce();
    } finally {
      await runtime.dispose();
    }
  });

  it.each(['send', 'initial queue'] as const)(
    'persists continuity before dispatch through %s',
    async (path) => {
      const intents = createMemorySessionIntentStore();
      const originalSave = intents.saveActive.bind(intents);
      const saving = deferred<void>();
      const finish = deferred<void>();
      vi.spyOn(intents, 'saveActive').mockImplementation(async (input) => {
        if ((input.payload as { unstarted?: boolean }).unstarted === false) {
          saving.resolve();
          await finish.promise;
        }
        return originalSave(input);
      });
      const h = makeAcpHarness({ intents });
      const runtime = new AcpRuntime(h.deps);
      const input = makeStartInput({ conversationId: 'durable-before-dispatch' });
      if (path === 'send') await runtime.startSession(input, 'resume');
      const sending =
        path === 'send'
          ? runtime.sendPrompt(input.conversationId, { text: 'hello' })
          : runtime.startSession({ ...input, initialQueue: [{ text: 'hello' }] }, 'fresh');
      try {
        await saving.promise;
        expect(h.agent.prompt).not.toHaveBeenCalled();
        finish.resolve();
        expect((await sending).success).toBe(true);
        await vi.waitFor(() => expect(h.agent.prompt).toHaveBeenCalledOnce());
        expect(intents.snapshot()[0]?.payload).toMatchObject({ unstarted: false });
      } finally {
        finish.resolve();
        await sending;
        await runtime.dispose();
      }
    }
  );

  it('does not dispatch when the continuity write fails, and allows a later retry', async () => {
    const intents = createMemorySessionIntentStore();
    const h = makeAcpHarness({ intents });
    const runtime = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'failed-save' });
    try {
      await runtime.startSession(input, 'resume');
      const save = vi
        .spyOn(intents, 'saveActive')
        .mockResolvedValue(err({ type: 'io', message: 'disk full' }));
      expect((await runtime.sendPrompt(input.conversationId, { text: 'hello' })).success).toBe(
        false
      );
      expect(h.agent.prompt).not.toHaveBeenCalled();
      save.mockRestore();
      expect((await runtime.sendPrompt(input.conversationId, { text: 'hello' })).success).toBe(
        true
      );
      await vi.waitFor(() => expect(h.agent.prompt).toHaveBeenCalledOnce());
    } finally {
      await runtime.dispose();
    }
  });

  it('preserves an unknown saved session and permits recovery with a corrected profile', async () => {
    const h = makeAcpHarness();
    const runtime = new AcpRuntime(h.deps);
    const input = makeStartInput({
      conversationId: 'legacy',
      sessionId: 'saved',
      env: { CLAUDE_CONFIG_DIR: '/wrong' },
    });
    h.agent.loadSession.mockRejectedValueOnce(
      Object.assign(new Error('Resource not found: saved'), {
        code: -32002,
        data: { uri: 'saved' },
      })
    );
    try {
      await runtime.attachSession(input);
      expect(await startAndLoadHistory(runtime, input)).toMatchObject({
        success: false,
        error: { type: 'session_not_found' },
      });
      expect(h.agent.newSession).not.toHaveBeenCalled();
      await runtime.attachSession({ ...input, env: { CLAUDE_CONFIG_DIR: '/correct' } });
      expect((await startAndLoadHistory(runtime, input)).success).toBe(true);
      expect(h.agent.loadSession).toHaveBeenCalledTimes(2);
    } finally {
      await runtime.dispose();
    }
  });

  it('never infers that an older persisted conversation was untouched', async () => {
    const intents = createMemorySessionIntentStore();
    const h = makeAcpHarness({ intents });
    let runtime = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'before-continuity-tracking' });
    try {
      await runtime.startSession(input, 'resume');
      await runtime.dispose();
      const intent = intents.snapshot()[0]!;
      const payload = { ...(intent.payload as Record<string, Serializable>) };
      delete payload.unstarted;
      await intents.saveActive({ ...intent, payload });
      runtime = new AcpRuntime(h.deps);
      await runtime.reconcile();
      await runtime.attachSession({ ...input, sessionId: 'session-1' });
      h.agent.loadSession.mockRejectedValueOnce(
        Object.assign(new Error('Resource not found'), {
          code: -32002,
          data: { uri: 'session-1' },
        })
      );
      expect(await startAndLoadHistory(runtime, input)).toMatchObject({
        success: false,
        error: { type: 'session_not_found' },
      });
      expect(h.agent.newSession).toHaveBeenCalledOnce();
      expect(intents.snapshot()[0]?.sessionId).toBe('session-1');
    } finally {
      await runtime.dispose();
    }
  });
});

async function startAndLoadHistory(runtime: AcpRuntime, input: ReturnType<typeof makeStartInput>) {
  const started = await runtime.startSession(input, 'resume');
  return started.success ? runtime.loadHistory(input.conversationId) : started;
}
