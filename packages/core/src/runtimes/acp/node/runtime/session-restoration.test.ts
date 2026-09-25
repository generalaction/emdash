import type { Serializable } from '@emdash/shared';
import { deferred } from '@emdash/shared/testing';
import { peek } from '@emdash/wire/state';
import { describe, expect, it, vi } from 'vitest';
import { acpErr } from '#runtimes/acp/api';
import { makeAcpHarness, makeStartInput } from '#runtimes/acp/node/acp-test-support';
import { SessionCell } from '#runtimes/acp/node/session/cell';
import { emptyRetainedPresentation } from '#runtimes/acp/node/state/live-models';
import { createMemorySessionIntentStore } from '#services/session-intents/api';
import { AcpRuntime } from './runtime';

const savedConfiguration = {
  model: 'saved-model',
  effort: 'high',
  collaborationMode: 'plan',
  modeId: 'agent-full-access',
};

function restorationConfigOptions(includeSaved: boolean) {
  return [
    { id: 'model', category: 'model', value: savedConfiguration.model },
    { id: 'reasoning_effort', category: 'thought_level', value: savedConfiguration.effort },
    {
      id: 'collaboration_mode',
      category: 'collaboration_mode',
      value: savedConfiguration.collaborationMode,
    },
    { id: 'mode', category: 'mode', value: savedConfiguration.modeId },
  ].map(({ id, category, value }) => ({
    id,
    name: id,
    category,
    type: 'select',
    currentValue: 'default',
    options: [
      { value: 'default', name: 'Default' },
      ...(includeSaved ? [{ value, name: value }] : []),
    ],
  }));
}

describe('ACP restoration continuity', () => {
  it.each(['new queue', 'new readiness', 'replay queue', 'replay finalization'] as const)(
    'retains the initial prompt across a worker restart after %s fails',
    async (failure) => {
      const intents = createMemorySessionIntentStore();
      const h = makeAcpHarness({ intents });
      let runtime = new AcpRuntime(h.deps);
      const input = makeStartInput({
        conversationId: 'initial-prompt-restart',
        sessionId: failure.startsWith('replay') ? 'original' : null,
        initialQueue: [{ text: 'do not lose this prompt' }],
      });
      const fault = failure.endsWith('queue')
        ? vi
            .spyOn(SessionCell.prototype, 'queuePrompt')
            .mockReturnValueOnce(acpErr.invalidState('queue rejected'))
        : vi
            .spyOn(
              SessionCell.prototype,
              failure === 'new readiness' ? 'applySessionReady' : 'endReplay'
            )
            .mockImplementationOnce(() => {
              throw new Error('readiness failed');
            });
      try {
        expect((await runtime.startSession(input, 'resume')).success).toBe(false);
        expect(h.agent.prompt).not.toHaveBeenCalled();
        await runtime.dispose();
        runtime = new AcpRuntime(h.deps);
        await runtime.reconcile();
        expect((await runtime.startSession(input, 'resume')).success).toBe(true);
        await vi.waitFor(() => expect(h.agent.prompt).toHaveBeenCalledOnce());
        expect(h.agent.prompt).toHaveBeenCalledWith(
          expect.objectContaining({
            prompt: [{ type: 'text', text: 'do not lose this prompt' }],
          })
        );
      } finally {
        fault.mockRestore();
        await runtime.dispose();
      }
    }
  );

  it.each(['replay finalization', 'initial queue'] as const)(
    'preserves saved configuration when %s fails after applying the provider catalog',
    async (failure) => {
      const intents = createMemorySessionIntentStore();
      const h = makeAcpHarness({ intents });
      const runtime = new AcpRuntime(h.deps);
      const input = makeStartInput({
        conversationId: 'failed-configuration-restore',
        sessionId: 'original',
        ...savedConfiguration,
        initialQueue: [{ text: 'continue after restoration' }],
      });
      await intents.saveActive({
        conversationId: input.conversationId,
        sessionId: input.sessionId,
        payload: {
          version: 1,
          conversationId: input.conversationId,
          providerId: input.providerId,
          cwd: input.cwd,
          sessionId: input.sessionId,
          configured: savedConfiguration,
          presentation: emptyRetainedPresentation(savedConfiguration),
        } as unknown as Serializable,
      });
      h.agent.loadSession
        .mockResolvedValueOnce({ configOptions: restorationConfigOptions(false) })
        .mockResolvedValueOnce({ configOptions: restorationConfigOptions(true) });
      const fault =
        failure === 'replay finalization'
          ? vi.spyOn(SessionCell.prototype, 'endReplay').mockImplementationOnce(() => {
              throw new Error('replay finalization failed');
            })
          : vi
              .spyOn(SessionCell.prototype, 'queuePrompt')
              .mockReturnValueOnce(acpErr.invalidState('initial queue rejected'));
      try {
        expect((await runtime.startSession(input, 'resume')).success).toBe(false);
        expect(fault).toHaveBeenCalledOnce();
        expect(h.agent.prompt).not.toHaveBeenCalled();
        expect(intents.snapshot()[0]).toMatchObject({
          sessionId: 'original',
          payload: { configured: savedConfiguration },
        });

        // Retry the same handle to verify its in-memory overrides survived too.
        expect((await startAndLoadHistory(runtime, input)).success).toBe(true);
        for (const option of restorationConfigOptions(true)) {
          expect(h.agent.setSessionConfigOption).toHaveBeenCalledWith({
            sessionId: 'original',
            configId: option.id,
            value: option.options[1]!.value,
          });
        }
        await vi.waitFor(() => expect(h.agent.prompt).toHaveBeenCalledOnce());
        expect(h.agent.setSessionConfigOption.mock.invocationCallOrder.at(-1)).toBeLessThan(
          h.agent.prompt.mock.invocationCallOrder[0]!
        );
        expect(intents.snapshot()[0]?.payload).toMatchObject({ configured: savedConfiguration });
      } finally {
        fault.mockRestore();
        await runtime.dispose();
      }
    }
  );

  it('persists unsupported selection removals after restoration succeeds', async () => {
    const intents = createMemorySessionIntentStore();
    const h = makeAcpHarness({ intents });
    const runtime = new AcpRuntime(h.deps);
    const input = makeStartInput({
      conversationId: 'successful-configuration-restore',
      sessionId: 'original',
      ...savedConfiguration,
    });
    h.agent.loadSession.mockResolvedValueOnce({ configOptions: restorationConfigOptions(false) });
    try {
      expect(await runtime.startSession(input, 'resume')).toMatchObject({
        success: true,
        data: { clearedConfiguration: ['model', 'effort', 'collaborationMode', 'modeId'] },
      });
      expect(intents.snapshot()[0]?.payload).toMatchObject({
        configured: { model: null, effort: null, collaborationMode: null, modeId: null },
      });
      expect(h.agent.setSessionConfigOption).not.toHaveBeenCalled();
    } finally {
      await runtime.dispose();
    }
  });

  it('preserves a newer supported selection made while applying restoration settings', async () => {
    const intents = createMemorySessionIntentStore();
    const h = makeAcpHarness({ intents });
    const runtime = new AcpRuntime(h.deps);
    const input = makeStartInput({
      conversationId: 'updated-restoration-settings',
      sessionId: 'original',
      ...savedConfiguration,
      model: 'removed-model',
    });
    h.agent.loadSession.mockResolvedValueOnce({ configOptions: restorationConfigOptions(true) });
    const applying = deferred<Record<string, never>>();
    h.agent.setSessionConfigOption.mockImplementationOnce(() => applying.promise);
    const loading = runtime.startSession(input, 'resume');
    try {
      await vi.waitFor(() => expect(h.agent.setSessionConfigOption).toHaveBeenCalledOnce());
      expect(
        (await runtime.setOption(input.conversationId, 'model', savedConfiguration.model)).success
      ).toBe(true);
      applying.resolve({});
      const result = await loading;
      expect(result).toMatchObject({ success: true });
      if (result.success) expect(result.data.clearedConfiguration).toBeUndefined();
      expect(h.agent.setSessionConfigOption).toHaveBeenCalledWith({
        sessionId: 'original',
        configId: 'model',
        value: savedConfiguration.model,
      });
      expect(intents.snapshot()[0]?.payload).toMatchObject({ configured: savedConfiguration });
    } finally {
      applying.resolve({});
      await loading;
      await runtime.dispose();
    }
  });

  it('does not replace a saved conversation when the provider cannot load sessions', async () => {
    const h = makeAcpHarness();
    h.agent.initialize.mockResolvedValueOnce({ protocolVersion: 1, agentCapabilities: {} });
    const runtime = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'unsupported-replay', sessionId: 'original' });
    try {
      await runtime.attachSession(input);
      expect((await startAndLoadHistory(runtime, input)).success).toBe(false);
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
    await runtime.startSession(input, 'resume');
    h.agent.closeSession.mockRejectedValueOnce(new Error('temporarily unavailable'));
    try {
      await runtime.stopSession(input.conversationId);
      expect((await startAndLoadHistory(runtime, input)).success).toBe(true);
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
      expect((await startAndLoadHistory(runtime, input)).success).toBe(false);
      expect(intents.snapshot()[0]?.sessionId).toBe('original');
      expect((await startAndLoadHistory(runtime, input)).success).toBe(true);
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
    await runtime.startSession(input, 'resume');
    h.agent.closeSession.mockImplementationOnce(() => closed.promise);
    const stopping = runtime.stopSession(input.conversationId);
    await vi.waitFor(() => expect(h.agent.closeSession).toHaveBeenCalledOnce());
    const loading = startAndLoadHistory(runtime, input);
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
    await runtime.startSession(input, 'resume');
    h.agent.closeSession.mockImplementationOnce(() => closed.promise);
    try {
      await runtime.stopSession(input.conversationId);
      const failed = await startAndLoadHistory(runtime, input);
      expect(failed.success).toBe(false);
      expect(h.agent.loadSession).not.toHaveBeenCalled();
      expect(h.agent.newSession).toHaveBeenCalledOnce();
      expect(h.agent.closeSession).toHaveBeenCalledOnce();
      closed.resolve();
      expect((await startAndLoadHistory(runtime, input)).success).toBe(true);
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
    await runtime.startSession(input, 'resume');
    h.agent.closeSession.mockImplementationOnce(() => closed.promise);
    try {
      await runtime.stopSession(input.conversationId);
      h.lastChild.emitExit(42);
      await vi.waitFor(() =>
        expect(
          runtime.connections.peek({ providerId: input.providerId, cwd: input.cwd })
        ).toBeUndefined()
      );
      expect((await startAndLoadHistory(runtime, input)).success).toBe(true);
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
      expect((await startAndLoadHistory(runtime, input)).success).toBe(false);
      expect(h.agent.newSession).not.toHaveBeenCalled();
      expect(intents.snapshot()[0]?.sessionId).toBe('original');
      expect((await startAndLoadHistory(runtime, input)).success).toBe(true);
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
    const loading = startAndLoadHistory(runtime, input);
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

async function startAndLoadHistory(runtime: AcpRuntime, input: ReturnType<typeof makeStartInput>) {
  const started = await runtime.startSession(input, 'resume');
  return started.success ? runtime.loadHistory(input.conversationId) : started;
}
