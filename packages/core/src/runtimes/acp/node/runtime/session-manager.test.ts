import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { isOk, ok } from '@emdash/shared';
import { createScope } from '@emdash/shared/concurrency';
import { createManualClock, deferred } from '@emdash/shared/testing';
import { observe, peek } from '@emdash/wire/state';
import { describe, expect, it, vi } from 'vitest';
import {
  FakeAcpTerminalProcess,
  makeAcpHarness,
  makeStartInput,
} from '#runtimes/acp/node/acp-test-support';
import { createRecordingConversationLifecycleReporter } from '#services/conversation-reports/node/testing';
import { createMemorySessionIntentStore } from '#services/session-intents/api';
import {
  expectNoSessionResidue,
  type LeakCheckContainer,
} from '#services/session-lifecycle/node/testing';
import { AcpRuntime } from './runtime';

async function launchHarness(conversationId = 'conv-1') {
  const h = makeAcpHarness();
  const rt = new AcpRuntime(h.deps);
  const result = await rt.launchSession(makeStartInput({ conversationId }));
  expect(isOk(result)).toBe(true);
  return { h, rt, client: h.client(), sessionId: 'session-1', conversationId };
}

describe('AcpRuntime session manager', () => {
  it('attaches and exposes a suspended projection without spawning, then activates separately', async () => {
    const h = makeAcpHarness();
    const rt = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'conv-attach', model: 'sonnet' });

    await expect(rt.attachSession(input)).resolves.toEqual(ok());

    expect(h.children).toHaveLength(0);
    expect(peek(rt.sessionLiveModels(input.conversationId)!.states.state)).toMatchObject({
      suspended: true,
      canSubmit: true,
    });

    await expect(rt.loadHistory(input.conversationId)).resolves.toMatchObject({
      success: true,
      data: { turns: [], nextCursor: null },
    });
    expect(h.children).toHaveLength(1);
  });

  it('clears stored selections only when an authoritative provider catalog excludes them', async () => {
    const h = makeAcpHarness();
    h.agent.newSession.mockResolvedValueOnce({
      sessionId: 'session-1',
      configOptions: [modelConfigOption('supported-model')],
    });
    const rt = new AcpRuntime(h.deps);

    const result = await rt.launchSession(
      makeStartInput({ conversationId: 'conv-unsupported-model', model: 'removed-model' })
    );

    expect(result).toMatchObject({
      success: true,
      data: { clearedConfiguration: ['model'] },
    });
    expect(h.agent.setSessionConfigOption).not.toHaveBeenCalled();

    const missingCatalogHarness = makeAcpHarness();
    missingCatalogHarness.agent.newSession.mockResolvedValueOnce({ sessionId: 'session-2' });
    const missingCatalogRuntime = new AcpRuntime(missingCatalogHarness.deps);
    const missingCatalogResult = await missingCatalogRuntime.launchSession(
      makeStartInput({ conversationId: 'conv-missing-catalog', model: 'keep-me' })
    );
    expect(missingCatalogResult).toMatchObject({ success: true, data: { sessionId: 'session-2' } });
    if (missingCatalogResult.success) {
      expect(missingCatalogResult.data.clearedConfiguration).toBeUndefined();
    }
  });

  it('maps ACP auth_required JSON-RPC errors to auth_required', async () => {
    const h = makeAcpHarness();
    const rt = new AcpRuntime(h.deps);
    h.agent.newSession.mockRejectedValueOnce({ code: -32000, message: 'Authentication required' });

    const result = await rt.launchSession(makeStartInput({ conversationId: 'conv-auth-required' }));

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.type).toBe('auth_required');
  });

  it('shares one process for conversations with the same provider and cwd', async () => {
    const clock = createManualClock(0);
    const h = makeAcpHarness({ clock, lifecycle: { connectionIdleTtlMs: 500 } });
    const rt = new AcpRuntime(h.deps);
    h.agent.newSession
      .mockResolvedValueOnce({ sessionId: 'session-a' })
      .mockResolvedValueOnce({ sessionId: 'session-b' });

    await rt.launchSession(makeStartInput({ conversationId: 'conv-a' }));
    await rt.launchSession(makeStartInput({ conversationId: 'conv-b' }));

    expect(h.children).toHaveLength(1);
    await rt.stopSession('conv-a');
    expect(h.lastChild.kill).not.toHaveBeenCalled();
    await rt.stopSession('conv-b');
    await clock.advanceBy(500);
    await vi.waitFor(() => {
      expect(h.lastChild.kill).toHaveBeenCalledWith('SIGTERM');
    });
  });

  it('deactivates idle sessions and releases the pooled ACP process after its TTL', async () => {
    const clock = createManualClock(0);
    const h = makeAcpHarness({
      clock,
      lifecycle: {
        session: { kind: 'idle-after', outputMs: 1_000 },
        sweepIntervalMs: 100,
        connectionIdleTtlMs: 500,
      },
    });
    const rt = new AcpRuntime(h.deps);
    await rt.launchSession(makeStartInput({ conversationId: 'conv-idle' }));
    const live = rt.sessionLiveModels('conv-idle');
    if (!live) throw new Error('expected stable live projection');

    await clock.advanceBy(1_200);
    await rt.manager.sweepNow();

    expect(peek(rt.sessionsListLiveModel().states.list)['conv-idle']).toMatchObject({
      suspended: true,
      lifecycle: 'closed',
    });
    expect(rt.sessionLiveModels('conv-idle')).toBe(live);
    expect(peek(live.states.state)).toMatchObject({ suspended: true, canSubmit: true });
    await clock.advanceBy(500);
    expect(h.lastChild.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('wakes a suspended conversation through loadSession before delivering a prompt', async () => {
    const h = makeAcpHarness({ lifecycle: { connectionIdleTtlMs: 0 } });
    const rt = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'conv-wake-prompt' });
    await rt.launchSession(input);
    const live = rt.sessionLiveModels(input.conversationId);
    if (!live) throw new Error('expected stable live projection');
    await rt.stopSession(input.conversationId);

    const replay = deferred<Record<string, never>>();
    h.agent.loadSession.mockImplementationOnce(async () => replay.promise);
    h.agent.prompt.mockClear();
    const sent = rt.sendPrompt(input.conversationId, { text: 'after suspension' });

    await vi.waitFor(() =>
      expect(h.agent.loadSession).toHaveBeenCalledWith({
        cwd: '/tmp/workspace',
        sessionId: 'session-1',
        mcpServers: [],
      })
    );
    expect(h.agent.prompt).not.toHaveBeenCalled();

    replay.resolve({});
    await expect(sent).resolves.toEqual(ok({ queued: false }));
    expect(h.agent.prompt).toHaveBeenCalledWith({
      sessionId: 'session-1',
      prompt: [{ type: 'text', text: 'after suspension' }],
    });
    expect(rt.sessionLiveModels(input.conversationId)).toBe(live);
    expect(peek(live.states.state)).toMatchObject({ lifecycle: 'ready' });
  });

  it('applies settings changed while materializing before one joined prompt', async () => {
    const h = makeAcpHarness({ lifecycle: { connectionIdleTtlMs: 0 } });
    h.agent.newSession.mockResolvedValueOnce({
      sessionId: 'session-1',
      configOptions: [effortConfigOption('low')],
    });
    const rt = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'conv-materializing-preferences' });
    await rt.launchSession(input);
    await rt.stopSession(input.conversationId);

    const replay = deferred<{ configOptions: ReturnType<typeof effortConfigOption>[] }>();
    h.agent.loadSession.mockImplementationOnce(async () => replay.promise);
    h.agent.setSessionConfigOption.mockClear();
    h.agent.prompt.mockClear();

    const activation = rt.loadHistory(input.conversationId);
    await vi.waitFor(() => expect(h.agent.loadSession).toHaveBeenCalledTimes(1));
    expect(peek(rt.sessionLiveModels(input.conversationId)!.states.state)).toMatchObject({
      canSubmit: true,
    });

    await expect(rt.setOption(input.conversationId, 'effort', 'high')).resolves.toEqual(ok());
    expect(peek(rt.sessionLiveModels(input.conversationId)!.states.config)).toMatchObject({
      efforts: { selected: 'high' },
    });
    const prompt = rt.sendPrompt(input.conversationId, { text: 'join activation' });

    expect(h.agent.loadSession).toHaveBeenCalledTimes(1);
    expect(h.agent.prompt).not.toHaveBeenCalled();

    replay.resolve({ configOptions: [effortConfigOption('low')] });
    await expect(activation).resolves.toMatchObject({ success: true });
    await expect(prompt).resolves.toEqual(ok({ queued: false }));

    expect(h.agent.setSessionConfigOption).toHaveBeenCalledTimes(1);
    expect(h.agent.setSessionConfigOption).toHaveBeenCalledWith({
      sessionId: 'session-1',
      configId: 'reasoning_effort',
      value: 'high',
    });
    expect(h.agent.prompt).toHaveBeenCalledTimes(1);
    expect(h.agent.setSessionConfigOption.mock.invocationCallOrder[0]).toBeLessThan(
      h.agent.prompt.mock.invocationCallOrder[0]!
    );
  });

  it('keeps no-wake operations suspended and activation-local', async () => {
    const h = makeAcpHarness({ lifecycle: { connectionIdleTtlMs: 0 } });
    const rt = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'conv-no-wake' });
    await rt.launchSession(input);
    await rt.stopSession(input.conversationId);
    h.agent.loadSession.mockClear();
    h.agent.newSession.mockClear();

    expect(rt.editQueuedPrompt(input.conversationId, 'missing', { text: 'edit' })).toEqual(ok());
    expect(rt.deleteQueuedPrompt(input.conversationId, 'missing')).toEqual(ok());
    expect(rt.changeQueuePromptOrder(input.conversationId, [])).toEqual(ok());
    expect(rt.resolvePermission(input.conversationId, 'stale', 'allow')).toEqual(ok());
    await expect(rt.cancelTurn(input.conversationId)).resolves.toEqual(ok());
    expect(rt.exportParsedTranscript(input.conversationId)).toMatchObject({
      success: false,
      error: { type: 'conversation_not_found' },
    });
    expect(rt.exportRawAcpLog(input.conversationId)).toMatchObject({
      success: false,
      error: { type: 'conversation_not_found' },
    });
    expect(h.agent.loadSession).not.toHaveBeenCalled();
    expect(h.agent.newSession).not.toHaveBeenCalled();
  });

  it('persists dormant settings without waking and applies them before the next prompt', async () => {
    const intents = createMemorySessionIntentStore();
    const h = makeAcpHarness({
      intents,
      lifecycle: { connectionIdleTtlMs: 0 },
    });
    h.agent.newSession.mockResolvedValueOnce({
      sessionId: 'session-1',
      configOptions: [modeConfigOption('agent'), effortConfigOption('low')],
    });
    const rt = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'conv-dormant-settings' });
    await rt.launchSession(input);
    await rt.stopSession(input.conversationId);
    h.agent.loadSession.mockClear();
    h.agent.newSession.mockClear();
    h.agent.setSessionConfigOption.mockClear();
    h.agent.prompt.mockClear();

    await expect(rt.setOption(input.conversationId, 'mode', 'agent-full-access')).resolves.toEqual(
      ok()
    );
    await expect(rt.setOption(input.conversationId, 'effort', 'high')).resolves.toEqual(ok());

    expect(h.agent.loadSession).not.toHaveBeenCalled();
    expect(h.agent.newSession).not.toHaveBeenCalled();
    expect(h.agent.setSessionConfigOption).not.toHaveBeenCalled();
    expect(intents.snapshot()[0]?.payload).toMatchObject({
      configured: { modeId: 'agent-full-access', effort: 'high' },
    });
    expect(peek(rt.sessionLiveModels(input.conversationId)!.states.config)).toMatchObject({
      modeOptions: { selected: 'agent-full-access' },
      efforts: { selected: 'high' },
    });

    h.agent.loadSession.mockResolvedValueOnce({
      configOptions: [modeConfigOption('agent'), effortConfigOption('low')],
    });
    await rt.sendPrompt(input.conversationId, { text: 'wake once' });

    expect(h.agent.loadSession).toHaveBeenCalledTimes(1);
    expect(h.agent.setSessionConfigOption).toHaveBeenCalledWith({
      sessionId: 'session-1',
      configId: 'mode',
      value: 'agent-full-access',
    });
    expect(h.agent.setSessionConfigOption).toHaveBeenCalledWith({
      sessionId: 'session-1',
      configId: 'reasoning_effort',
      value: 'high',
    });
    expect(h.agent.prompt).toHaveBeenCalledTimes(1);
  });

  it('does not wake or block no-wake operations while an activation is stopping', async () => {
    const promptDeferred = deferred<{ stopReason: 'end_turn' }>();
    const h = makeAcpHarness({ lifecycle: { activationDrainTimeoutMs: 1_000 } });
    h.agent.prompt.mockImplementationOnce(async () => promptDeferred.promise);
    const rt = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'conv-no-wake-stopping' });
    await rt.launchSession(input);
    const prompt = rt.sendPrompt(input.conversationId, { text: 'long turn' });
    await vi.waitFor(() => expect(h.agent.prompt).toHaveBeenCalledTimes(1));

    const stop = rt.stopSession(input.conversationId);
    await vi.waitFor(() => expect(h.agent.closeSession).toHaveBeenCalledTimes(1));
    h.agent.loadSession.mockClear();
    expect(rt.editQueuedPrompt(input.conversationId, 'missing', { text: 'edit' })).toEqual(ok());
    expect(rt.deleteQueuedPrompt(input.conversationId, 'missing')).toEqual(ok());
    expect(rt.changeQueuePromptOrder(input.conversationId, [])).toEqual(ok());
    expect(rt.resolvePermission(input.conversationId, 'stale', 'allow')).toEqual(ok());
    await expect(rt.cancelTurn(input.conversationId)).resolves.toEqual(ok());
    expect(h.agent.loadSession).not.toHaveBeenCalled();

    promptDeferred.resolve({ stopReason: 'end_turn' });
    await prompt;
    await stop;
  });

  it('returns to suspended when an implicit wake fails', async () => {
    const h = makeAcpHarness({ lifecycle: { connectionIdleTtlMs: 0 } });
    const rt = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'conv-wake-failure' });
    await rt.launchSession(input);
    const live = rt.sessionLiveModels(input.conversationId);
    if (!live) throw new Error('expected stable live projection');
    await rt.stopSession(input.conversationId);
    h.agent.loadSession.mockRejectedValueOnce(new Error('replay failed'));
    h.agent.newSession.mockRejectedValueOnce(new Error('replacement failed'));

    const result = await rt.sendPrompt(input.conversationId, { text: 'retry me' });

    expect(result).toMatchObject({
      success: false,
      error: { kind: 'wake-failed', error: { type: 'new_session_failed' } },
    });
    expect(peek(live.states.state)).toMatchObject({ suspended: true, canSubmit: true });
    expect(peek(rt.sessionsListLiveModel().states.list)[input.conversationId]).toMatchObject({
      suspended: true,
    });
  });

  it('suspends a crashed mid-turn activation without automatically waking it', async () => {
    const pendingPrompt = deferred<{ stopReason: 'end_turn' }>();
    const h = makeAcpHarness({ lifecycle: { activationDrainTimeoutMs: 1_000 } });
    h.agent.prompt.mockImplementationOnce(async () => pendingPrompt.promise);
    const rt = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'conv-crash-mid-turn' });
    await rt.launchSession(input);
    const prompt = rt.sendPrompt(input.conversationId, { text: 'in flight' });
    await vi.waitFor(() => expect(h.agent.prompt).toHaveBeenCalledTimes(1));
    h.agent.loadSession.mockClear();
    h.agent.newSession.mockClear();

    h.lastChild.emitExit(42);

    await vi.waitFor(() =>
      expect(peek(rt.sessionLiveModels(input.conversationId)!.states.state)).toMatchObject({
        suspended: true,
      })
    );
    expect(h.agent.loadSession).not.toHaveBeenCalled();
    expect(h.agent.newSession).not.toHaveBeenCalled();
    pendingPrompt.reject(new Error('provider exited'));
    await prompt;
  });

  it('interrupts a long turn and finishes kill after the bounded lease drain', async () => {
    const never = deferred<{ stopReason: 'end_turn' }>();
    const h = makeAcpHarness({ lifecycle: { activationDrainTimeoutMs: 10 } });
    h.agent.prompt.mockImplementationOnce(async () => never.promise);
    const rt = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'conv-kill-long-turn' });
    await rt.launchSession(input);
    void rt.sendPrompt(input.conversationId, { text: 'long turn' });
    await vi.waitFor(() => expect(h.agent.prompt).toHaveBeenCalledTimes(1));

    const termination = rt.terminateSession(input.conversationId);
    await expect(rt.sendPrompt(input.conversationId, { text: 'too late' })).resolves.toMatchObject({
      success: false,
      error: { type: 'conversation_not_found' },
    });
    await termination;

    expect(h.agent.cancel).toHaveBeenCalledWith({ sessionId: 'session-1' });
    expect(h.agent.closeSession).toHaveBeenCalledWith({ sessionId: 'session-1' });
    expectNoSessionResidue(input.conversationId, leakContainers(rt));
  });

  it('kills a conversation while a new session is still starting', async () => {
    const starting = deferred<{ sessionId: string }>();
    const h = makeAcpHarness();
    h.agent.newSession.mockImplementationOnce(async () => starting.promise);
    const rt = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'conv-kill-starting' });
    const launch = rt.launchSession(input);
    await vi.waitFor(() => expect(h.agent.newSession).toHaveBeenCalledTimes(1));

    await rt.terminateSession(input.conversationId);

    await expect(launch).resolves.toMatchObject({ success: false });
    expectNoSessionResidue(input.conversationId, leakContainers(rt));
  });

  it('kills a conversation while loadSession is replaying', async () => {
    const replaying = deferred<Record<string, never>>();
    const h = makeAcpHarness();
    h.agent.loadSession.mockImplementationOnce(async () => replaying.promise);
    const rt = new AcpRuntime(h.deps);
    const input = {
      ...makeStartInput({ conversationId: 'conv-kill-replaying' }),
      sessionId: 'old',
    };
    const launch = rt.launchSession(input);
    await vi.waitFor(() => expect(h.agent.loadSession).toHaveBeenCalledTimes(1));

    await rt.terminateSession(input.conversationId);

    await expect(launch).resolves.toMatchObject({ success: false });
    expect(h.agent.closeSession).toHaveBeenCalledWith({ sessionId: 'old' });
    expectNoSessionResidue(input.conversationId, leakContainers(rt));
  });

  it('runs initialQueue only on the first materialization despite repeated start input', async () => {
    const h = makeAcpHarness({ lifecycle: { connectionIdleTtlMs: 0 } });
    const rt = new AcpRuntime(h.deps);
    const input = makeStartInput({
      conversationId: 'conv-initial-queue-once',
      initialQueue: [{ text: 'bootstrap' }],
    });

    await rt.launchSession(input);
    await vi.waitFor(() => expect(h.agent.prompt).toHaveBeenCalledTimes(1));
    await rt.launchSession(input);
    expect(h.agent.prompt).toHaveBeenCalledTimes(1);
    await rt.stopSession(input.conversationId);
    await rt.launchSession(input);

    expect(h.agent.loadSession).toHaveBeenCalledWith({
      cwd: '/tmp/workspace',
      sessionId: 'session-1',
      mcpServers: [],
    });
    expect(h.agent.prompt).toHaveBeenCalledTimes(1);
  });

  it('retains fallback session ids and effort overrides across rematerialization', async () => {
    const intents = createMemorySessionIntentStore();
    const h = makeAcpHarness({ intents, lifecycle: { connectionIdleTtlMs: 0 } });
    h.agent.loadSession.mockRejectedValueOnce(new Error('old session missing'));
    h.agent.newSession.mockResolvedValueOnce({
      sessionId: 'replacement',
      configOptions: [effortConfigOption('low')],
    });
    const rt = new AcpRuntime(h.deps);
    const input = {
      ...makeStartInput({ conversationId: 'conv-retained-config' }),
      sessionId: 'old',
    };
    await rt.launchSession(input);
    await rt.setOption(input.conversationId, 'effort', 'high');
    await vi.waitFor(() =>
      expect(intents.snapshot()[0]?.payload).toMatchObject({
        sessionId: 'replacement',
        configured: { effort: 'high' },
      })
    );
    await rt.stopSession(input.conversationId);
    h.agent.loadSession.mockClear();
    h.agent.setSessionConfigOption.mockClear();
    h.agent.loadSession.mockResolvedValueOnce({
      configOptions: [effortConfigOption('low')],
    });

    await rt.launchSession(input);

    expect(h.agent.loadSession).toHaveBeenCalledWith({
      cwd: '/tmp/workspace',
      sessionId: 'replacement',
      mcpServers: [],
    });
    expect(h.agent.setSessionConfigOption).toHaveBeenCalledWith({
      sessionId: 'replacement',
      configId: 'reasoning_effort',
      value: 'high',
    });
  });

  it('keeps a newer runtime session id when attach races host-report convergence', async () => {
    const h = makeAcpHarness({ lifecycle: { connectionIdleTtlMs: 0 } });
    h.agent.newSession.mockResolvedValueOnce({ sessionId: 'replacement' });
    const rt = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'conv-attach-session-race' });
    await rt.launchSession(input);
    await rt.stopSession(input.conversationId);
    h.agent.loadSession.mockResolvedValueOnce({});

    await rt.attachSession({ ...input, sessionId: 'stale-host-session' });
    await rt.loadHistory(input.conversationId);

    expect(h.agent.loadSession).toHaveBeenCalledWith({
      cwd: '/tmp/workspace',
      sessionId: 'replacement',
      mcpServers: [],
    });
  });

  it('retains mode changes across rematerialization despite stale bootstrap input', async () => {
    const h = makeAcpHarness({ lifecycle: { connectionIdleTtlMs: 0 } });
    h.agent.newSession.mockResolvedValueOnce({
      sessionId: 'session-1',
      configOptions: [modeConfigOption('agent')],
    });
    const rt = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'conv-retained-mode', modeId: null });
    await rt.launchSession(input);
    await rt.setOption(input.conversationId, 'mode', 'agent-full-access');
    await rt.stopSession(input.conversationId);
    h.agent.setSessionConfigOption.mockClear();
    h.agent.loadSession.mockResolvedValueOnce({
      configOptions: [modeConfigOption('agent')],
    });

    await rt.launchSession(input);

    expect(h.agent.setSessionConfigOption).toHaveBeenCalledWith({
      sessionId: 'session-1',
      configId: 'mode',
      value: 'agent-full-access',
    });
  });

  it('restores suspended retained descriptors without waking during boot reconcile', async () => {
    const intents = createMemorySessionIntentStore();
    const firstHarness = makeAcpHarness({ intents, lifecycle: { connectionIdleTtlMs: 0 } });
    firstHarness.agent.newSession.mockResolvedValueOnce({
      sessionId: 'session-1',
      configOptions: [effortConfigOption('low')],
    });
    const firstRuntime = new AcpRuntime(firstHarness.deps);
    const input = makeStartInput({ conversationId: 'conv-boot-retained' });
    await firstRuntime.launchSession(input);
    await firstRuntime.setOption(input.conversationId, 'effort', 'high');
    await firstRuntime.stopSession(input.conversationId);
    await vi.waitFor(() => expect(intents.snapshot()[0]?.status).toBe('suspended'));
    await firstRuntime.dispose();

    const secondHarness = makeAcpHarness({ intents });
    secondHarness.agent.loadSession.mockResolvedValueOnce({
      configOptions: [effortConfigOption('low')],
    });
    const secondRuntime = new AcpRuntime(secondHarness.deps);
    await secondRuntime.reconcile();

    expect(secondHarness.agent.loadSession).not.toHaveBeenCalled();
    await secondRuntime.attachSession({ ...input, sessionId: 'session-1', effort: 'high' });
    expect(peek(secondRuntime.sessionLiveModels(input.conversationId)!.states.state)).toMatchObject(
      {
        suspended: true,
        canSubmit: true,
      }
    );
    await secondRuntime.sendPrompt(input.conversationId, { text: 'wake after boot' });
    expect(secondHarness.agent.loadSession).toHaveBeenCalledWith({
      cwd: '/tmp/workspace',
      sessionId: 'session-1',
      mcpServers: [],
    });
    expect(secondHarness.agent.setSessionConfigOption).toHaveBeenCalledWith({
      sessionId: 'session-1',
      configId: 'reasoning_effort',
      value: 'high',
    });
  });

  it('ignores a stale process-close callback from a replaced connection generation', async () => {
    const h = makeAcpHarness({ lifecycle: { connectionIdleTtlMs: 0 } });
    const rt = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'conv-stale-close' });
    await rt.launchSession(input);
    await rt.stopSession(input.conversationId);
    await rt.launchSession(input);

    rt.manager.onProcessClosed('claude:/tmp/workspace', 1, 42);

    expect(rt.getSessionState(input.conversationId)).toMatchObject({ lifecycle: 'ready' });
    const state = peek(rt.sessionLiveModels(input.conversationId)!.states.state);
    expect(state).toMatchObject({ lifecycle: 'ready' });
    expect(state?.suspended).toBeUndefined();
  });

  it('reconciles legacy intents without spawning and activates only with fresh attached env', async () => {
    const intents = createMemorySessionIntentStore();
    const { sessionId: _, ...legacyInput } = makeStartInput({
      conversationId: 'conv-reconcile',
    });
    await intents.saveActive({
      conversationId: 'conv-reconcile',
      sessionId: 'session-old',
      payload: {
        ...legacyInput,
        projectId: 'project-1',
        taskId: 'task-1',
        workspaceId: 'workspace-1',
        env: { API_TOKEN: 'legacy-secret' },
        sessionId: 'session-old',
      },
    });
    const h = makeAcpHarness({ intents });
    const rt = new AcpRuntime(h.deps);

    await rt.reconcile();

    expect(h.agent.loadSession).not.toHaveBeenCalled();
    expect(h.agent.newSession).not.toHaveBeenCalled();
    expect(peek(rt.sessionsListLiveModel().states.list)).toHaveProperty('conv-reconcile');
    await expect(
      rt.sendPrompt('conv-reconcile', { text: 'must attach first' })
    ).resolves.toMatchObject({
      success: false,
      error: { type: 'conversation_not_found' },
    });
    expect(h.children).toHaveLength(0);
    const [sanitized] = intents.snapshot();
    expect(sanitized).toMatchObject({ status: 'suspended' });
    expect(JSON.stringify(sanitized)).not.toContain('API_TOKEN');
    expect(JSON.stringify(sanitized)).not.toContain('legacy-secret');

    const spawn = vi.spyOn(h.fakeHost, 'spawn');
    await rt.attachSession({
      ...makeStartInput({ conversationId: 'conv-reconcile' }),
      sessionId: 'session-old',
      env: { API_TOKEN: 'fresh-secret' },
    });
    expect(spawn).not.toHaveBeenCalled();

    await rt.loadHistory('conv-reconcile');

    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({ env: expect.objectContaining({ API_TOKEN: 'fresh-secret' }) })
    );
    expect(JSON.stringify(intents.snapshot())).not.toContain('fresh-secret');
  });

  it('injects host-scoped MCP servers into new ACP sessions', async () => {
    const h = makeAcpHarness();
    h.agent.initialize.mockResolvedValueOnce({
      protocolVersion: 1,
      agentCapabilities: { loadSession: true, mcpCapabilities: { http: true } },
    });
    vi.spyOn(h.deps.agentHost, 'readMcpServers').mockResolvedValueOnce(
      ok([
        {
          name: 'filesystem',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem'],
        },
        {
          name: 'docs',
          type: 'http',
          url: 'https://example.com/mcp',
        },
      ])
    );
    const rt = new AcpRuntime(h.deps);

    const result = await rt.launchSession(makeStartInput({ conversationId: 'conv-mcp' }));

    expect(isOk(result)).toBe(true);
    expect(h.agent.newSession).toHaveBeenCalledWith({
      cwd: '/tmp/workspace',
      mcpServers: [
        {
          name: 'filesystem',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem'],
          env: [],
        },
        {
          type: 'http',
          name: 'docs',
          url: 'https://example.com/mcp',
          headers: [],
        },
      ],
    });
    expect(peek(rt.sessionLiveModels('conv-mcp')!.states.mcpServers)).toEqual([
      { name: 'filesystem', transport: 'stdio' },
      { name: 'docs', transport: 'http' },
    ]);
  });

  it('injects host-scoped MCP servers into loaded ACP sessions', async () => {
    const h = makeAcpHarness();
    vi.spyOn(h.deps.agentHost, 'readMcpServers').mockResolvedValueOnce(
      ok([{ name: 'filesystem', command: 'npx' }])
    );
    const rt = new AcpRuntime(h.deps);

    const result = await rt.launchSession({
      ...makeStartInput({ conversationId: 'conv-load-mcp' }),
      sessionId: 'session-old',
    });

    expect(isOk(result)).toBe(true);
    expect(h.agent.loadSession).toHaveBeenCalledWith({
      cwd: '/tmp/workspace',
      sessionId: 'session-old',
      mcpServers: [{ name: 'filesystem', command: 'npx', args: [], env: [] }],
    });
    expect(peek(rt.sessionLiveModels('conv-load-mcp')!.states.mcpServers)).toEqual([
      { name: 'filesystem', transport: 'stdio' },
    ]);
  });

  it('re-applies the persisted mode after a new session starts', async () => {
    const h = makeAcpHarness();
    h.agent.newSession.mockResolvedValueOnce({
      sessionId: 'session-1',
      configOptions: [modeConfigOption('agent')],
    });
    const rt = new AcpRuntime(h.deps);

    const result = await rt.launchSession(
      makeStartInput({ conversationId: 'conv-mode', modeId: 'agent-full-access' })
    );

    expect(isOk(result)).toBe(true);
    expect(h.agent.setSessionConfigOption).toHaveBeenCalledWith({
      sessionId: 'session-1',
      configId: 'mode',
      value: 'agent-full-access',
    });
  });

  it('re-applies the persisted mode after a session is loaded', async () => {
    const h = makeAcpHarness();
    h.agent.loadSession.mockResolvedValueOnce({
      configOptions: [modeConfigOption('agent')],
    });
    const rt = new AcpRuntime(h.deps);

    const result = await rt.launchSession({
      ...makeStartInput({ conversationId: 'conv-mode-load', modeId: 'agent-full-access' }),
      sessionId: 'session-old',
    });

    expect(isOk(result)).toBe(true);
    expect(h.agent.setSessionConfigOption).toHaveBeenCalledWith({
      sessionId: 'session-old',
      configId: 'mode',
      value: 'agent-full-access',
    });
  });

  it('skips the persisted mode when the agent does not advertise it', async () => {
    const h = makeAcpHarness();
    h.agent.newSession.mockResolvedValueOnce({
      sessionId: 'session-1',
      configOptions: [modeConfigOption('agent')],
    });
    const rt = new AcpRuntime(h.deps);

    const result = await rt.launchSession(
      makeStartInput({ conversationId: 'conv-mode-unknown', modeId: 'bypass-everything' })
    );

    expect(isOk(result)).toBe(true);
    expect(h.agent.setSessionConfigOption).not.toHaveBeenCalled();
    expect(h.agent.setSessionMode).not.toHaveBeenCalled();
  });

  it('skips the persisted mode when it is already selected', async () => {
    const h = makeAcpHarness();
    h.agent.newSession.mockResolvedValueOnce({
      sessionId: 'session-1',
      configOptions: [modeConfigOption('agent-full-access')],
    });
    const rt = new AcpRuntime(h.deps);

    const result = await rt.launchSession(
      makeStartInput({ conversationId: 'conv-mode-selected', modeId: 'agent-full-access' })
    );

    expect(isOk(result)).toBe(true);
    expect(h.agent.setSessionConfigOption).not.toHaveBeenCalled();
    expect(h.agent.setSessionMode).not.toHaveBeenCalled();
  });

  it('does not fail the start when applying the persisted mode errors', async () => {
    const h = makeAcpHarness();
    h.agent.newSession.mockResolvedValueOnce({
      sessionId: 'session-1',
      configOptions: [modeConfigOption('agent')],
    });
    h.agent.setSessionConfigOption.mockRejectedValueOnce(new Error('mode change rejected'));
    const rt = new AcpRuntime(h.deps);

    const result = await rt.launchSession(
      makeStartInput({ conversationId: 'conv-mode-error', modeId: 'agent-full-access' })
    );

    expect(isOk(result)).toBe(true);
  });

  it('persists the current resume input without desktop identifiers', async () => {
    const intents = createMemorySessionIntentStore();
    const h = makeAcpHarness({ intents });
    const rt = new AcpRuntime(h.deps);

    await rt.launchSession(makeStartInput({ conversationId: 'conv-persisted' }));

    await vi.waitFor(() => expect(intents.snapshot()).toHaveLength(1));
    expect(intents.snapshot()[0]?.payload).toMatchObject({
      version: '1',
      conversationId: 'conv-persisted',
      providerId: 'claude',
      cwd: '/tmp/workspace',
      sessionId: 'session-1',
      configured: { model: null, modeId: null, effort: null },
    });
  });

  it('persists idle deactivation as a suspended intent', async () => {
    const clock = createManualClock(0);
    const intents = createMemorySessionIntentStore({ now: () => clock.now() });
    const h = makeAcpHarness({
      clock,
      intents,
      lifecycle: {
        session: { kind: 'idle-after', outputMs: 1_000 },
        sweepIntervalMs: 1_100,
      },
    });
    const rt = new AcpRuntime(h.deps);
    await rt.launchSession(makeStartInput({ conversationId: 'conv-idle-intent' }));

    await clock.advanceBy(1_200);

    await vi.waitFor(() => {
      expect(intents.snapshot()[0]).toMatchObject({
        conversationId: 'conv-idle-intent',
        status: 'suspended',
        suspendedCause: 'idle',
      });
    });
  });

  it('removes persisted ACP intent when a session is killed', async () => {
    const intents = createMemorySessionIntentStore();
    const h = makeAcpHarness({ intents });
    const rt = new AcpRuntime(h.deps);
    await rt.launchSession(makeStartInput({ conversationId: 'conv-kill' }));

    await vi.waitFor(() => expect(intents.snapshot()).toHaveLength(1));
    await rt.terminateSession('conv-kill');

    await vi.waitFor(() => expect(intents.snapshot()).toEqual([]));
    expectNoSessionResidue('conv-kill', leakContainers(rt));
  });

  it('publishes activeTurn patches without root replacement during incremental text growth', async () => {
    const { h, rt, client, sessionId } = await launchHarness('conv-live');
    let resolvePrompt!: (value: { stopReason: 'end_turn' }) => void;
    h.agent.prompt = vi.fn(
      () =>
        new Promise<{ stopReason: 'end_turn' }>((resolve) => {
          resolvePrompt = resolve;
        })
    );
    const live = rt.sessionLiveModels('conv-live');
    if (!live) throw new Error('expected live models');
    const scope = createScope({ label: 'test:active-turn' });
    const updates: unknown[] = [];
    observe(live.states.activeTurn, (snapshot) => updates.push(snapshot.value), { scope });

    const prompt = rt.sendPrompt('conv-live', { text: 'hello' });
    await vi.waitFor(() => expect(h.agent.prompt).toHaveBeenCalledTimes(1));
    updates.length = 0;
    await client.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        sessionId,
        messageId: 'msg-1',
        content: { type: 'text', text: 'hel' },
      } as SessionUpdate,
    });
    updates.length = 0;
    await client.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        sessionId,
        messageId: 'msg-1',
        content: { type: 'text', text: 'lo' },
      } as SessionUpdate,
    });

    expect(updates.length).toBeGreaterThan(0);
    expect(JSON.stringify(peek(live.states.activeTurn))).toContain('hello');
    await scope.dispose();
    resolvePrompt({ stopReason: 'end_turn' });
    await prompt;
  });

  it('publishes usage updates through live models', async () => {
    const { rt, client, sessionId } = await launchHarness('conv-usage');
    const live = rt.sessionLiveModels('conv-usage');
    if (!live) throw new Error('expected live models');
    const scope = createScope({ label: 'test:usage' });
    const updates: unknown[] = [];
    observe(live.states.usage, (snapshot) => updates.push(snapshot.value), { scope });

    await client.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: 'usage_update',
        sessionId,
        used: 42_000,
        size: 200_000,
        cost: { amount: 0.25, currency: 'USD' },
      } as SessionUpdate,
    });

    expect(peek(live.states.usage)).toEqual({
      contextUsed: 42_000,
      contextSize: 200_000,
      cost: { amount: 0.25, currency: 'USD' },
    });
    expect(updates.length).toBeGreaterThan(0);
    await scope.dispose();
  });

  it('keeps stored attachment ids in user transcript messages', async () => {
    const resolveAttachment = vi.fn().mockResolvedValue({
      data: 'base64-image',
      mimeType: 'image/png',
    });
    const h = makeAcpHarness({ resolveAttachment });
    const rt = new AcpRuntime(h.deps);
    const started = await rt.launchSession(makeStartInput({ conversationId: 'conv-attachment' }));
    expect(isOk(started)).toBe(true);

    const sent = await rt.sendPrompt('conv-attachment', {
      text: 'look',
      attachments: [
        {
          type: 'attachment',
          id: 'attachment-1',
          name: 'image.png',
          mimeType: 'image/png',
        },
      ],
    });

    expect(isOk(sent)).toBe(true);
    expect(resolveAttachment).toHaveBeenCalledWith('conv-attachment', {
      type: 'attachment',
      id: 'attachment-1',
      name: 'image.png',
      mimeType: 'image/png',
    });
    expect(h.agent.prompt).toHaveBeenCalledWith({
      sessionId: 'session-1',
      prompt: [
        { type: 'image', data: 'base64-image', mimeType: 'image/png' },
        { type: 'text', text: 'look' },
      ],
    });

    const history = await rt.loadHistory('conv-attachment');
    expect(isOk(history)).toBe(true);
    if (!isOk(history)) return;
    expect(history.data.turns[0].items[0]).toMatchObject({
      kind: 'message',
      text: 'look',
      attachments: [{ id: 'attachment-1', name: 'image.png', mimeType: 'image/png' }],
    });
  });

  it('sends hidden prompt context to the agent without adding it to the transcript', async () => {
    const h = makeAcpHarness();
    const rt = new AcpRuntime(h.deps);
    const started = await rt.launchSession(
      makeStartInput({ conversationId: 'conv-hidden-context' })
    );
    expect(isOk(started)).toBe(true);

    const sent = await rt.sendPrompt('conv-hidden-context', {
      text: 'Fix @[ENG-123](issue:linear:ENG-123)',
      hiddenContext: '<issue_context identifier="ENG-123">Context body</issue_context>',
    });

    expect(isOk(sent)).toBe(true);
    expect(h.agent.prompt).toHaveBeenCalledWith({
      sessionId: 'session-1',
      prompt: [
        { type: 'text', text: 'Fix @[ENG-123](issue:linear:ENG-123)' },
        { type: 'text', text: '<issue_context identifier="ENG-123">Context body</issue_context>' },
      ],
    });

    const history = await rt.loadHistory('conv-hidden-context');
    expect(isOk(history)).toBe(true);
    if (!isOk(history)) return;
    expect(history.data.turns[0].items[0]).toMatchObject({
      kind: 'message',
      text: 'Fix @[ENG-123](issue:linear:ENG-123)',
    });
    expect(JSON.stringify(history.data.turns[0].items[0])).not.toContain('Context body');
  });

  it('delivers a prompt immediately with default placement when the session is idle', async () => {
    const { h, rt } = await launchHarness('conv-placement-auto');

    const sent = await rt.sendPrompt('conv-placement-auto', { text: 'now' });

    expect(isOk(sent)).toBe(true);
    if (!isOk(sent)) return;
    expect(sent.data).toEqual({ queued: false });
    expect(h.agent.prompt).toHaveBeenCalledTimes(1);
    expect(rt.getSessionState('conv-placement-auto').queuedPrompts).toEqual([]);
  });

  it('queues a prompt with default placement while a turn is active', async () => {
    const { h, rt } = await launchHarness('conv-placement-active');
    let resolvePrompt!: (value: { stopReason: 'end_turn' }) => void;
    h.agent.prompt = vi.fn(
      () =>
        new Promise<{ stopReason: 'end_turn' }>((resolve) => {
          resolvePrompt = resolve;
        })
    );

    const first = rt.sendPrompt('conv-placement-active', { text: 'first' });
    const second = await rt.sendPrompt('conv-placement-active', { text: 'second' });

    expect(isOk(second)).toBe(true);
    if (!isOk(second)) return;
    expect(second.data).toEqual({ queued: true });
    expect(rt.getSessionState('conv-placement-active').queuedPrompts).toMatchObject([
      { text: 'second' },
    ]);

    resolvePrompt({ stopReason: 'end_turn' });
    const firstResult = await first;
    expect(isOk(firstResult)).toBe(true);
    if (!isOk(firstResult)) return;
    expect(firstResult.data).toEqual({ queued: false });
  });

  it("delivers a prompt with placement 'queue' immediately when idle", async () => {
    const { h, rt } = await launchHarness('conv-placement-queue');

    const result = await rt.sendPrompt('conv-placement-queue', { text: 'later' }, 'queue');

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.data).toEqual({ queued: false });
    expect(h.agent.prompt).toHaveBeenCalledTimes(1);
    expect(rt.getSessionState('conv-placement-queue').queuedPrompts).toEqual([]);
  });

  it("keeps placement 'queue' queued while a turn is active", async () => {
    const { h, rt } = await launchHarness('conv-placement-queue-active');
    let resolvePrompt!: (value: { stopReason: 'end_turn' }) => void;
    h.agent.prompt = vi.fn(
      () =>
        new Promise<{ stopReason: 'end_turn' }>((resolve) => {
          resolvePrompt = resolve;
        })
    );

    const first = rt.sendPrompt('conv-placement-queue-active', { text: 'first' });
    const second = await rt.sendPrompt('conv-placement-queue-active', { text: 'second' }, 'queue');

    expect(isOk(second)).toBe(true);
    if (!isOk(second)) return;
    expect(second.data).toEqual({ queued: true });
    expect(rt.getSessionState('conv-placement-queue-active').queuedPrompts).toMatchObject([
      { text: 'second' },
    ]);

    resolvePrompt({ stopReason: 'end_turn' });
    await first;
  });

  it('loads replayed history after attaching a resumable conversation', async () => {
    const h = makeAcpHarness();
    const rt = new AcpRuntime(h.deps);
    h.agent.loadSession = vi.fn(async () => {
      await h.client().sessionUpdate({
        sessionId: 'session-old',
        update: {
          sessionUpdate: 'agent_message_chunk',
          sessionId: 'session-old',
          messageId: 'msg-1',
          content: { type: 'text', text: 'from history' },
        } as SessionUpdate,
      });
      return {};
    });

    const input = {
      ...makeStartInput({ conversationId: 'conv-resume' }),
      sessionId: 'session-old',
    };
    await rt.attachSession(input);
    const result = await rt.loadHistory(input.conversationId);

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.data.turns).toHaveLength(1);
    expect(result.data.turns[0].items[0]).toMatchObject({
      kind: 'message',
      text: 'from history',
    });
  });

  it('publishes terminal state and output through live primitives', async () => {
    const { h, rt, client, sessionId } = await launchHarness('conv-terminal');
    const terminal = new FakeAcpTerminalProcess();
    h.fakeHost.nextTerminal = terminal;
    const created = await client.createTerminal!({
      sessionId,
      command: 'echo',
      args: [],
      cwd: '/tmp',
    });

    expect(peek(rt.sessionLiveModels('conv-terminal')!.states.terminals)).toMatchObject([
      { terminalId: created.terminalId, command: 'echo', exitStatus: null },
    ]);

    const log = rt.terminalOutputLog(created.terminalId);
    if (!log) throw new Error('expected terminal log');
    const updates: unknown[] = [];
    const unsub = log.subscribe((update) => updates.push(update));
    terminal.pushOutput('hello');

    terminal.pushOutput(' world');

    expect(log.snapshot().data.text).toBe('hello world');
    expect(updates).toHaveLength(2);
    expect(updates.at(-1)).toMatchObject({ delta: { chunk: ' world' } });

    terminal.triggerExit({ exitCode: 0, signal: null });
    expect(peek(rt.sessionLiveModels('conv-terminal')!.states.terminals)).toMatchObject([
      { terminalId: created.terminalId, exitStatus: { exitCode: 0, signal: null } },
    ]);
    unsub();
  });

  it('suspends sessions when the process closes', async () => {
    const { h, rt } = await launchHarness('conv-close');
    const live = rt.sessionLiveModels('conv-close');
    if (!live) throw new Error('expected stable live projection');

    h.lastChild.emitExit(42);

    await vi.waitFor(() => expect(rt.getSessionState('conv-close').lifecycle).toBe('closed'));
    expect(rt.sessionLiveModels('conv-close')).toBe(live);
    expect(peek(live.states.state)).toMatchObject({ suspended: true, canSubmit: true });
    expect(peek(rt.sessionsListLiveModel().states.list)['conv-close']).toMatchObject({
      suspended: true,
    });
  });

  it('suspends all sessions sharing a process when that process closes', async () => {
    const h = makeAcpHarness();
    const rt = new AcpRuntime(h.deps);
    h.agent.newSession
      .mockResolvedValueOnce({ sessionId: 'session-a' })
      .mockResolvedValueOnce({ sessionId: 'session-b' });

    await rt.launchSession(makeStartInput({ conversationId: 'conv-a' }));
    await rt.launchSession(makeStartInput({ conversationId: 'conv-b' }));
    expect(h.children).toHaveLength(1);

    h.lastChild.emitExit(42);

    await vi.waitFor(() => {
      expect(rt.getSessionState('conv-a').lifecycle).toBe('closed');
      expect(rt.getSessionState('conv-b').lifecycle).toBe('closed');
    });
    expect(peek(rt.sessionLiveModels('conv-a')!.states.state)).toMatchObject({ suspended: true });
    expect(peek(rt.sessionLiveModels('conv-b')!.states.state)).toMatchObject({ suspended: true });
    expect(peek(rt.sessionsListLiveModel().states.list)).toMatchObject({
      'conv-a': { suspended: true },
      'conv-b': { suspended: true },
    });
  });
});

// Property conv.sole-writer / spec §7.4: session facts (spawn, provider-id rebind, activity,
// end, resume outcome) flow from the session runtime into the conversation index via
// lifecycle reports.
describe('AcpRuntime conversation lifecycle reports', () => {
  it('reports a fresh session start with the provider session id and no resume outcome', async () => {
    const reports = createRecordingConversationLifecycleReporter();
    const h = makeAcpHarness({ conversationReports: reports });
    const rt = new AcpRuntime(h.deps);

    await rt.launchSession(makeStartInput({ conversationId: 'conv-fresh' }));

    expect(reports.started).toEqual([
      { conversationId: 'conv-fresh', providerSessionId: 'session-1', resumeOutcome: null },
    ]);
    expect(reports.activities).toContain('conv-fresh');
  });

  it("reports resumeOutcome 'loaded' when the provider replays the session", async () => {
    const reports = createRecordingConversationLifecycleReporter();
    const h = makeAcpHarness({ conversationReports: reports });
    const rt = new AcpRuntime(h.deps);
    h.agent.loadSession = vi.fn(async () => ({}));

    await rt.launchSession({
      ...makeStartInput({ conversationId: 'conv-resume' }),
      sessionId: 'session-old',
    });

    expect(reports.started).toEqual([
      { conversationId: 'conv-resume', providerSessionId: 'session-old', resumeOutcome: 'loaded' },
    ]);
  });

  it("reports resumeOutcome 'replaced-by-new' when loadSession fails and a fresh session starts", async () => {
    const reports = createRecordingConversationLifecycleReporter();
    const h = makeAcpHarness({ conversationReports: reports });
    const rt = new AcpRuntime(h.deps);
    h.agent.loadSession = vi.fn(async () => {
      throw new Error('session file is gone');
    });

    const result = await rt.launchSession({
      ...makeStartInput({ conversationId: 'conv-fallback' }),
      sessionId: 'session-old',
    });

    expect(isOk(result)).toBe(true);
    expect(reports.started).toEqual([
      {
        conversationId: 'conv-fallback',
        providerSessionId: 'session-1',
        resumeOutcome: 'replaced-by-new',
      },
    ]);
  });

  it('reports the rebound provider session id when updates arrive under a new id', async () => {
    const reports = createRecordingConversationLifecycleReporter();
    const h = makeAcpHarness({ conversationReports: reports });
    const rt = new AcpRuntime(h.deps);
    h.agent.loadSession = vi.fn(async () => {
      await h.client().sessionUpdate({
        sessionId: 'session-rebound',
        update: {
          sessionUpdate: 'agent_message_chunk',
          sessionId: 'session-rebound',
          messageId: 'msg-1',
          content: { type: 'text', text: 'hello' },
        } as SessionUpdate,
      });
      return {};
    });

    await rt.launchSession({
      ...makeStartInput({ conversationId: 'conv-rebind' }),
      sessionId: 'session-old',
    });

    expect(reports.providerIds).toEqual([
      { conversationId: 'conv-rebind', providerSessionId: 'session-rebound' },
    ]);
  });

  it('reports session end exactly once on user stop', async () => {
    const reports = createRecordingConversationLifecycleReporter();
    const h = makeAcpHarness({ conversationReports: reports });
    const rt = new AcpRuntime(h.deps);
    await rt.launchSession(makeStartInput({ conversationId: 'conv-stop' }));

    await rt.stopSession('conv-stop');

    expect(reports.ended).toEqual(['conv-stop']);
    expect(rt.manager.inspect().running).not.toContain('conv-stop');
    expect(rt.manager.inspect().retained).toContain('conv-stop');
  });

  it('reports session end exactly once when the provider process dies', async () => {
    const reports = createRecordingConversationLifecycleReporter();
    const h = makeAcpHarness({ conversationReports: reports });
    const rt = new AcpRuntime(h.deps);
    await rt.launchSession(makeStartInput({ conversationId: 'conv-died' }));

    h.lastChild.emitExit(42);

    await vi.waitFor(() => {
      expect(reports.ended).toEqual(['conv-died']);
    });
    // The cell onClosed eviction and the process-close eviction coalesce.
    await vi.waitFor(() =>
      expect(peek(rt.sessionLiveModels('conv-died')!.states.state)).toMatchObject({
        suspended: true,
      })
    );
    expect(reports.ended).toEqual(['conv-died']);
    expect(rt.manager.inspect().running).not.toContain('conv-died');
    expect(rt.manager.inspect().retained).toContain('conv-died');
  });

  it('suspends the persisted intent when the provider process dies', async () => {
    const intents = createMemorySessionIntentStore();
    const h = makeAcpHarness({ intents });
    const rt = new AcpRuntime(h.deps);
    await rt.launchSession(makeStartInput({ conversationId: 'conv-crash' }));
    await vi.waitFor(() => expect(intents.snapshot()).toHaveLength(1));

    h.lastChild.emitExit(42);

    await vi.waitFor(() => {
      expect(intents.snapshot()[0]).toMatchObject({
        conversationId: 'conv-crash',
        status: 'suspended',
      });
    });
  });

  it('reports session end and cleans up when the start fails before a session exists', async () => {
    const reports = createRecordingConversationLifecycleReporter();
    const h = makeAcpHarness({ conversationReports: reports });
    const rt = new AcpRuntime(h.deps);
    h.agent.newSession.mockRejectedValueOnce(new Error('agent refused'));

    const result = await rt.launchSession(makeStartInput({ conversationId: 'conv-start-fail' }));

    expect(result.success).toBe(false);
    expect(reports.ended).toEqual(['conv-start-fail']);
    expectNoSessionResidue('conv-start-fail', leakContainers(rt));
  });

  it('reuses the connection lease across the loadSession fallback (no pool churn)', async () => {
    const h = makeAcpHarness();
    const rt = new AcpRuntime(h.deps);
    h.agent.loadSession = vi.fn(async () => {
      throw new Error('session file is gone');
    });

    const result = await rt.launchSession({
      ...makeStartInput({ conversationId: 'conv-lease' }),
      sessionId: 'session-old',
    });

    expect(isOk(result)).toBe(true);
    expect(h.children).toHaveLength(1);
    expect(h.lastChild.kill).not.toHaveBeenCalled();
    expect(rt.sessionLiveModels('conv-lease')).not.toBeNull();
  });
});

/** Uses the runtime's inspection seams so leak assertions follow production ownership. */
function leakContainers(rt: AcpRuntime): LeakCheckContainer[] {
  return [
    { name: 'running', has: (key) => rt.manager.inspect().running.includes(key) },
    { name: 'retained', has: (key) => rt.manager.inspect().retained.includes(key) },
    {
      name: 'materializing',
      has: (key) => rt.manager.inspect().materializing.includes(key),
    },
    {
      name: 'pendingEvictions',
      has: (key) => rt.manager.inspect().pendingEvictions.includes(key),
    },
    { name: 'routes', has: (key) => rt.manager.router.hasRoutesFor(key) },
    {
      name: 'loadingConversations',
      has: (key) => rt.manager.router.isLoadingConversation(key),
    },
    { name: 'liveModels', has: (key) => rt.sessionLiveModels(key) !== null },
    {
      name: 'sessionsList',
      has: (key) => key in peek(rt.sessionsListLiveModel().states.list),
    },
  ];
}

function modelConfigOption(currentValue: string) {
  return {
    id: 'model',
    name: 'Model',
    category: 'model',
    type: 'select',
    currentValue,
    options: [{ value: 'supported-model', name: 'Supported model' }],
  };
}

function modeConfigOption(currentValue: string) {
  return {
    id: 'mode',
    name: 'Mode',
    category: 'mode',
    type: 'select',
    currentValue,
    options: [
      { value: 'agent', name: 'Agent' },
      { value: 'agent-full-access', name: 'Agent (full access)' },
    ],
  };
}

function effortConfigOption(currentValue: string) {
  return {
    id: 'reasoning_effort',
    name: 'Reasoning effort',
    category: 'thought_level',
    type: 'select',
    currentValue,
    options: [
      { value: 'low', name: 'Low' },
      { value: 'high', name: 'High' },
    ],
  };
}
