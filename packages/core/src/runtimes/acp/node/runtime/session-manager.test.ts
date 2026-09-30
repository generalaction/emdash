import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { isOk, ok } from '@emdash/shared';
import { createScope } from '@emdash/shared/concurrency';
import { createManualClock, deferred } from '@emdash/shared/testing';
import { observe, peek } from '@emdash/wire/state';
import { describe, expect, it, vi } from 'vitest';
import {
  FakeAcpTerminalProcess,
  FakeAcpAgent,
  makeAcpHarness,
  makeStartInput,
} from '#runtimes/acp/node/acp-test-support';
import { emptyRetainedPresentation } from '#runtimes/acp/node/state/live-models';
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
  const result = await rt.startSession(makeStartInput({ conversationId }), 'resume');
  expect(isOk(result)).toBe(true);
  return { h, rt, client: h.client(), sessionId: 'session-1', conversationId };
}
describe('AcpRuntime session manager', () => {
  it('publishes adapter startup diagnostics through MCP live state without starting a turn', async () => {
    const agent = new FakeAcpAgent();
    const h = makeAcpHarness({
      acpBehavior: {
        buildSpawn: () => ({ command: '/fake/node', args: ['agent.js'], env: {} }),
        connect: agent.behavior.connect,
        enrich: (event) =>
          event.kind === 'tool_call' && event.toolCallId === 'startup-diagnostic'
            ? { kind: 'mcp_startup_failure', server: 'docs', error: 'Connection refused' }
            : event,
      },
    });
    vi.spyOn(h.deps.agentHost, 'readMcpServers').mockResolvedValueOnce(
      ok([{ name: 'docs', command: 'docs-mcp' }])
    );
    const rt = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'conv-mcp-diagnostic' });
    await rt.startSession(input, 'resume');
    await agent.capturedClient!.sessionUpdate({
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'startup-diagnostic',
        title: 'Startup',
        status: 'failed',
        kind: 'other',
      },
    });
    const live = rt.sessionLiveModels(input.conversationId)!;
    expect(peek(live.states.mcpServers)).toEqual([
      { name: 'docs', transport: 'stdio', startupError: 'Connection refused' },
    ]);
    expect(peek(live.states.state)?.transcript?.activeTurn ?? null).toBeNull();
    expect(peek(live.states.state)).toMatchObject({ agentTurnActive: false, isGenerating: false });
    // An ordinary failed tool call is still conversational content.
    await agent.capturedClient!.sessionUpdate({
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'ordinary-call',
        title: 'Search docs',
        status: 'failed',
        kind: 'other',
      },
    });
    expect(peek(live.states.state)?.transcript?.activeTurn ?? null).not.toBeNull();
    await rt.dispose();
  });
  it('attaches and exposes a suspended projection without spawning, then activates separately', async () => {
    const h = makeAcpHarness();
    const rt = new AcpRuntime(h.deps);
    const input = makeStartInput({
      conversationId: 'conv-attach',
      options: {
        model: 'sonnet',
      },
    });
    await expect(rt.attachSession(input)).resolves.toEqual(ok({ sessionId: null }));
    expect(h.children).toHaveLength(0);
    expect(peek(rt.sessionLiveModels(input.conversationId)!.states.state)).toMatchObject({
      suspended: true,
      canSubmit: true,
    });

    await expect(startAndLoadHistory(rt, input.conversationId)).resolves.toMatchObject({
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
    const result = await rt.startSession(
      makeStartInput({
        conversationId: 'conv-unsupported-model',
        options: {
          model: 'removed-model',
          collaboration_mode: 'plan',
        },
      }),
      'resume'
    );
    expect(result).toMatchObject({
      success: true,
    });
    expect(h.agent.setSessionConfigOption).not.toHaveBeenCalled();
    const missingCatalogHarness = makeAcpHarness();
    missingCatalogHarness.agent.newSession.mockResolvedValueOnce({ sessionId: 'session-2' });
    const missingCatalogRuntime = new AcpRuntime(missingCatalogHarness.deps);
    const missingCatalogResult = await missingCatalogRuntime.startSession(
      makeStartInput({
        conversationId: 'conv-missing-catalog',
        options: {
          model: 'keep-me',
          collaboration_mode: 'plan',
        },
      }),
      'resume'
    );
    expect(missingCatalogResult).toMatchObject({ success: true, data: { sessionId: 'session-2' } });
  });
  it.each(['opus[1m]', 'claude-fable-5-1[1m]', 'gpt-6-sol', 'gpt-6-luna'])(
    'applies initial model %s before the first prompt and restores it on resume',
    async (model) => {
      const h = makeAcpHarness({ lifecycle: { connectionIdleTtlMs: 0 } });
      const configOption = {
        id: 'model',
        name: 'Model',
        category: 'model' as const,
        type: 'select' as const,
        currentValue: 'default-model',
        options: [
          { value: 'default-model', name: 'Default model' },
          { value: model, name: 'Selected model' },
        ],
      };
      h.agent.newSession.mockResolvedValue({
        sessionId: 'session-1',
        configOptions: [configOption],
      });
      h.agent.loadSession.mockResolvedValue({ configOptions: [configOption] });
      h.agent.setSessionConfigOption.mockImplementation(async ({ value }) => ({
        configOptions: [{ ...configOption, currentValue: value }],
      }));
      const rt = new AcpRuntime(h.deps);
      const input = makeStartInput({
        initialQueue: [{ text: 'First prompt' }],
        options: {
          model: model,
        },
      });
      try {
        const result = await rt.startSession(input, 'resume');
        expect(result).toMatchObject({ success: true });
        await vi.waitFor(() => expect(h.agent.prompt).toHaveBeenCalledOnce());
        expect(h.agent.setSessionConfigOption).toHaveBeenCalledWith({
          sessionId: 'session-1',
          configId: 'model',
          value: model,
        });
        expect(h.agent.setSessionConfigOption.mock.invocationCallOrder[0]).toBeLessThan(
          h.agent.prompt.mock.invocationCallOrder[0]!
        );
        expect(peek(rt.sessionLiveModels(input.conversationId)!.states.config)).toMatchObject({
          options: [
            {
              category: 'model',
              currentValue: model,
            },
          ],
        });
        await rt.stopSession(input.conversationId);
        h.agent.setSessionConfigOption.mockClear();
        await startAndLoadHistory(rt, input.conversationId);
        expect(h.agent.loadSession).toHaveBeenCalledOnce();
        expect(h.agent.setSessionConfigOption).toHaveBeenCalledWith({
          sessionId: 'session-1',
          configId: 'model',
          value: model,
        });
        expect(peek(rt.sessionLiveModels(input.conversationId)!.states.config)).toMatchObject({
          options: [
            {
              category: 'model',
              currentValue: model,
            },
          ],
        });
      } finally {
        await rt.dispose();
      }
    }
  );
  it('maps ACP auth_required JSON-RPC errors to auth_required', async () => {
    const h = makeAcpHarness();
    const rt = new AcpRuntime(h.deps);
    h.agent.newSession.mockRejectedValueOnce({ code: -32000, message: 'Authentication required' });

    const result = await rt.startSession(
      makeStartInput({ conversationId: 'conv-auth-required' }),
      'resume'
    );

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

    await rt.startSession(makeStartInput({ conversationId: 'conv-a' }), 'resume');
    await rt.startSession(makeStartInput({ conversationId: 'conv-b' }), 'resume');

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
        session: { kind: 'idle-after', outputMs: 1000 },
        sweepIntervalMs: 100,
        connectionIdleTtlMs: 500,
      },
    });
    const rt = new AcpRuntime(h.deps);
    await rt.startSession(makeStartInput({ conversationId: 'conv-idle' }), 'resume');
    const live = rt.sessionLiveModels('conv-idle');
    if (!live) throw new Error('expected stable live projection');
    await clock.advanceBy(1200);
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
    await rt.startSession(input, 'resume');
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
    await rt.startSession(input, 'resume');
    await rt.stopSession(input.conversationId);
    const replay = deferred<{
      configOptions: ReturnType<typeof effortConfigOption>[];
    }>();
    h.agent.loadSession.mockImplementationOnce(async () => replay.promise);
    h.agent.setSessionConfigOption.mockClear();
    h.agent.prompt.mockClear();

    const activation = startAndLoadHistory(rt, input.conversationId);
    await vi.waitFor(() => expect(h.agent.loadSession).toHaveBeenCalledTimes(1));
    expect(peek(rt.sessionLiveModels(input.conversationId)!.states.state)).toMatchObject({
      canSubmit: true,
    });
    await expect(rt.setOption(input.conversationId, 'reasoning_effort', 'high')).resolves.toEqual(
      ok({ reapplyFailures: [] })
    );
    expect(
      peek(rt.sessionLiveModels(input.conversationId)!.states.config)?.configuredOptions
    ).toEqual({ reasoning_effort: 'high' });
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
    await rt.startSession(input, 'resume');
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
      configOptions: [
        modeConfigOption('agent'),
        effortConfigOption('low'),
        collaborationModeConfigOption('default'),
      ],
    });
    const rt = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'conv-dormant-settings' });
    await rt.startSession(input, 'resume');
    await rt.stopSession(input.conversationId);
    h.agent.loadSession.mockClear();
    h.agent.newSession.mockClear();
    h.agent.setSessionConfigOption.mockClear();
    h.agent.prompt.mockClear();
    await expect(rt.setOption(input.conversationId, 'mode', 'agent-full-access')).resolves.toEqual(
      ok({ reapplyFailures: [] })
    );
    await expect(rt.setOption(input.conversationId, 'reasoning_effort', 'high')).resolves.toEqual(
      ok({ reapplyFailures: [] })
    );
    await expect(rt.setOption(input.conversationId, 'collaboration_mode', 'plan')).resolves.toEqual(
      ok({ reapplyFailures: [] })
    );
    expect(h.agent.loadSession).not.toHaveBeenCalled();
    expect(h.agent.newSession).not.toHaveBeenCalled();
    expect(h.agent.setSessionConfigOption).not.toHaveBeenCalled();
    expect(intents.snapshot()[0]?.payload).toMatchObject({
      configured: {
        options: {
          mode: 'agent-full-access',
          reasoning_effort: 'high',
          collaboration_mode: 'plan',
        },
      },
    });
    expect(
      peek(rt.sessionLiveModels(input.conversationId)!.states.config)?.configuredOptions
    ).toEqual({ mode: 'agent-full-access', reasoning_effort: 'high', collaboration_mode: 'plan' });
    h.agent.loadSession.mockResolvedValueOnce({
      configOptions: [
        modeConfigOption('agent'),
        effortConfigOption('low'),
        collaborationModeConfigOption('default'),
      ],
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
    expect(h.agent.setSessionConfigOption).toHaveBeenCalledWith({
      sessionId: 'session-1',
      configId: 'collaboration_mode',
      value: 'plan',
    });
    expect(h.agent.prompt).toHaveBeenCalledTimes(1);
  });
  it('does not wake or block no-wake operations while an activation is stopping', async () => {
    const promptDeferred = deferred<{
      stopReason: 'end_turn';
    }>();
    const h = makeAcpHarness({ lifecycle: { activationDrainTimeoutMs: 1000 } });
    h.agent.prompt.mockImplementationOnce(async () => promptDeferred.promise);
    const rt = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'conv-no-wake-stopping' });
    await rt.startSession(input, 'resume');
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
    await rt.startSession(input, 'resume');
    const live = rt.sessionLiveModels(input.conversationId);
    if (!live) throw new Error('expected stable live projection');
    await rt.stopSession(input.conversationId);
    h.agent.loadSession.mockRejectedValueOnce(new Error('replay failed'));
    const result = await rt.sendPrompt(input.conversationId, { text: 'retry me' });
    expect(result).toMatchObject({
      success: false,
      error: { type: 'invalid_state' },
    });
    expect(peek(live.states.state)).toMatchObject({ suspended: true, canSubmit: true });
    expect(peek(rt.sessionsListLiveModel().states.list)[input.conversationId]).toMatchObject({
      suspended: true,
    });
  });
  it('suspends a crashed mid-turn activation without automatically waking it', async () => {
    const pendingPrompt = deferred<{
      stopReason: 'end_turn';
    }>();
    const h = makeAcpHarness({ lifecycle: { activationDrainTimeoutMs: 1000 } });
    h.agent.prompt.mockImplementationOnce(async () => pendingPrompt.promise);
    const rt = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'conv-crash-mid-turn' });
    await rt.startSession(input, 'resume');
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
    const never = deferred<{
      stopReason: 'end_turn';
    }>();
    const h = makeAcpHarness({ lifecycle: { activationDrainTimeoutMs: 10 } });
    h.agent.prompt.mockImplementationOnce(async () => never.promise);
    const rt = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'conv-kill-long-turn' });
    await rt.startSession(input, 'resume');
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
    const starting = deferred<{
      sessionId: string;
    }>();
    const h = makeAcpHarness();
    h.agent.newSession.mockImplementationOnce(async () => starting.promise);
    const rt = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'conv-kill-starting' });
    const launch = rt.startSession(input, 'resume');
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
    const launch = rt.startSession(input, 'resume');
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

    await rt.startSession(input, 'resume');
    await vi.waitFor(() => expect(h.agent.prompt).toHaveBeenCalledTimes(1));
    await rt.startSession(input, 'resume');
    expect(h.agent.prompt).toHaveBeenCalledTimes(1);
    await rt.stopSession(input.conversationId);
    await rt.startSession(input, 'resume');

    expect(h.agent.loadSession).toHaveBeenCalledWith({
      cwd: '/tmp/workspace',
      sessionId: 'session-1',
      mcpServers: [],
    });
    expect(h.agent.prompt).toHaveBeenCalledTimes(1);
  });
  it('retains the original session id and effort overrides after failed restoration', async () => {
    const intents = createMemorySessionIntentStore();
    const h = makeAcpHarness({ intents, lifecycle: { connectionIdleTtlMs: 0 } });
    h.agent.loadSession.mockRejectedValueOnce(new Error('old session missing'));
    const rt = new AcpRuntime(h.deps);
    const input = {
      ...makeStartInput({ conversationId: 'conv-retained-config' }),
      sessionId: 'old',
    };
    await rt.startSession(input, 'resume');
    await rt.setOption(input.conversationId, 'reasoning_effort', 'high');
    await vi.waitFor(() =>
      expect(intents.snapshot()[0]?.payload).toMatchObject({
        sessionId: 'old',
        configured: {
          options: {
            reasoning_effort: 'high',
          },
        },
      })
    );
    await rt.stopSession(input.conversationId);
    h.agent.loadSession.mockClear();
    h.agent.setSessionConfigOption.mockClear();
    h.agent.loadSession.mockResolvedValueOnce({
      configOptions: [effortConfigOption('low')],
    });

    await rt.startSession(input, 'resume');

    expect(h.agent.loadSession).toHaveBeenCalledWith({
      cwd: '/tmp/workspace',
      sessionId: 'old',
      mcpServers: [],
    });
    expect(h.agent.setSessionConfigOption).toHaveBeenCalledWith({
      sessionId: 'old',
      configId: 'reasoning_effort',
      value: 'high',
    });
  });
  it('retains restored session ids and effort overrides across rematerialization', async () => {
    const intents = createMemorySessionIntentStore();
    const h = makeAcpHarness({ intents, lifecycle: { connectionIdleTtlMs: 0 } });
    h.agent.loadSession.mockResolvedValueOnce({
      configOptions: [effortConfigOption('low')],
    });
    const rt = new AcpRuntime(h.deps);
    const input = {
      ...makeStartInput({ conversationId: 'conv-retained-config' }),
      sessionId: 'old',
    };
    await rt.startSession(input, 'resume');
    await rt.setOption(input.conversationId, 'reasoning_effort', 'high');
    await vi.waitFor(() =>
      expect(intents.snapshot()[0]?.payload).toMatchObject({
        sessionId: 'old',
        configured: {
          options: {
            reasoning_effort: 'high',
          },
        },
      })
    );
    await rt.stopSession(input.conversationId);
    h.agent.loadSession.mockClear();
    h.agent.setSessionConfigOption.mockClear();
    h.agent.loadSession.mockResolvedValueOnce({
      configOptions: [effortConfigOption('low')],
    });

    await rt.startSession(input, 'resume');

    expect(h.agent.loadSession).toHaveBeenCalledWith({
      cwd: '/tmp/workspace',
      sessionId: 'old',
      mcpServers: [],
    });
    expect(h.agent.setSessionConfigOption).toHaveBeenCalledWith({
      sessionId: 'old',
      configId: 'reasoning_effort',
      value: 'high',
    });
  });
  it('replaces retained capabilities when a loaded session omits config options', async () => {
    const h = makeAcpHarness({ lifecycle: { connectionIdleTtlMs: 0 } });
    h.agent.newSession.mockResolvedValueOnce({
      sessionId: 'session-1',
      configOptions: [effortConfigOption('medium')],
    });
    const rt = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'conv-omitted-config-options' });

    await rt.startSession(input, 'resume');
    const live = rt.sessionLiveModels(input.conversationId);
    if (!live) throw new Error('expected stable live projection');
    expect(
      peek(live.states.config)?.options?.find((option) => option.category === 'thought_level')
        ?.currentValue
    ).toBe('medium');
    await rt.stopSession(input.conversationId);
    h.agent.loadSession.mockResolvedValueOnce({});
    await rt.startSession(input, 'resume');
    expect(
      peek(live.states.config)?.options?.find((option) => option.category === 'thought_level')
    ).toBeUndefined();
  });
  it('keeps a newer runtime session id when attach races host-report convergence', async () => {
    const h = makeAcpHarness({ lifecycle: { connectionIdleTtlMs: 0 } });
    h.agent.newSession.mockResolvedValueOnce({ sessionId: 'replacement' });
    const rt = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'conv-attach-session-race' });
    await rt.startSession(input, 'resume');
    await rt.stopSession(input.conversationId);
    h.agent.loadSession.mockResolvedValueOnce({});
    await rt.attachSession({ ...input, sessionId: 'stale-host-session' });
    await startAndLoadHistory(rt, input.conversationId);

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
    const input = makeStartInput({ conversationId: 'conv-retained-mode' });
    await rt.startSession(input, 'resume');
    await rt.setOption(input.conversationId, 'mode', 'agent-full-access');
    await rt.stopSession(input.conversationId);
    h.agent.setSessionConfigOption.mockClear();
    h.agent.loadSession.mockResolvedValueOnce({
      configOptions: [modeConfigOption('agent')],
    });

    await rt.startSession(input, 'resume');

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
    await firstRuntime.startSession(input, 'resume');
    await firstRuntime.setOption(input.conversationId, 'reasoning_effort', 'high');
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
    await secondRuntime.attachSession({
      ...input,
      sessionId: 'session-1',
      options: { reasoning_effort: 'high' },
    });
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
    await rt.startSession(input, 'resume');
    await rt.stopSession(input.conversationId);
    await rt.startSession(input, 'resume');

    rt.manager.onProcessClosed('claude:/tmp/workspace', 1, 42);
    expect(rt.getSessionState(input.conversationId)).toMatchObject({ lifecycle: 'ready' });
    const state = peek(rt.sessionLiveModels(input.conversationId)!.states.state);
    expect(state).toMatchObject({ lifecycle: 'ready' });
    expect(state?.suspended).toBeUndefined();
  });
  it('reconciles native intents without spawning and activates only with fresh attached env', async () => {
    const intents = createMemorySessionIntentStore();
    const { sessionId: _, ...storedInput } = makeStartInput({
      conversationId: 'conv-reconcile',
    });
    await intents.saveActive({
      conversationId: 'conv-reconcile',
      sessionId: 'session-old',
      payload: {
        ...storedInput,
        version: '1',
        configured: { options: {} },
        presentation: emptyRetainedPresentation({ options: {} }),
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

    await startAndLoadHistory(rt, 'conv-reconcile');

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

    const result = await rt.startSession(makeStartInput({ conversationId: 'conv-mcp' }), 'resume');

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

    const result = await rt.startSession(
      {
        ...makeStartInput({ conversationId: 'conv-load-mcp' }),
        sessionId: 'session-old',
      },
      'resume'
    );

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
    const result = await rt.startSession(
      makeStartInput({
        conversationId: 'conv-mode',
        options: {
          mode: 'agent-full-access',
        },
      }),
      'resume'
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
    const result = await rt.startSession(
      {
        ...makeStartInput({
          conversationId: 'conv-mode-load',
          options: {
            mode: 'agent-full-access',
          },
        }),
        sessionId: 'session-old',
      },
      'resume'
    );
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
    const result = await rt.startSession(
      makeStartInput({
        conversationId: 'conv-mode-unknown',
        options: {
          mode: 'bypass-everything',
        },
      }),
      'resume'
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
    const result = await rt.startSession(
      makeStartInput({
        conversationId: 'conv-mode-selected',
        options: {
          mode: 'agent-full-access',
        },
      }),
      'resume'
    );
    expect(isOk(result)).toBe(true);
    expect(h.agent.setSessionConfigOption).not.toHaveBeenCalled();
    expect(h.agent.setSessionMode).not.toHaveBeenCalled();
  });
  it('fails startup before prompting when the selected mode cannot be applied', async () => {
    const h = makeAcpHarness();
    h.agent.newSession.mockResolvedValueOnce({
      sessionId: 'session-1',
      configOptions: [modeConfigOption('agent')],
    });
    h.agent.setSessionConfigOption.mockRejectedValueOnce(new Error('mode change rejected'));
    const rt = new AcpRuntime(h.deps);
    const result = await rt.startSession(
      makeStartInput({
        conversationId: 'conv-mode-error',
        initialQueue: [{ text: 'Run only with the selected mode' }],
        options: {
          mode: 'agent-full-access',
        },
      }),
      'resume'
    );
    expect(result).toMatchObject({ success: false });
    expect(h.agent.prompt).not.toHaveBeenCalled();
  });
  it('persists the current resume input without desktop identifiers', async () => {
    const intents = createMemorySessionIntentStore();
    const h = makeAcpHarness({ intents });
    const rt = new AcpRuntime(h.deps);

    await rt.startSession(makeStartInput({ conversationId: 'conv-persisted' }), 'resume');

    await vi.waitFor(() => expect(intents.snapshot()).toHaveLength(1));
    expect(intents.snapshot()[0]?.payload).toMatchObject({
      version: '1',
      conversationId: 'conv-persisted',
      providerId: 'claude',
      cwd: '/tmp/workspace',
      sessionId: 'session-1',
      configured: {},
    });
  });
  it('persists idle deactivation as a suspended intent', async () => {
    const clock = createManualClock(0);
    const intents = createMemorySessionIntentStore({ now: () => clock.now() });
    const h = makeAcpHarness({
      clock,
      intents,
      lifecycle: {
        session: { kind: 'idle-after', outputMs: 1000 },
        sweepIntervalMs: 1100,
      },
    });
    const rt = new AcpRuntime(h.deps);
    await rt.startSession(makeStartInput({ conversationId: 'conv-idle-intent' }), 'resume');

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
    await rt.startSession(makeStartInput({ conversationId: 'conv-kill' }), 'resume');

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
        new Promise<{
          stopReason: 'end_turn';
        }>((resolve) => {
          resolvePrompt = resolve;
        })
    );
    const live = rt.sessionLiveModels('conv-live');
    if (!live) throw new Error('expected live models');
    const scope = createScope({ label: 'test:active-turn' });
    const updates: unknown[] = [];
    observe(
      live.states.state,
      (snapshot) => updates.push(snapshot.value?.transcript?.activeTurn ?? null),
      { scope }
    );
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
    expect(JSON.stringify(peek(live.states.state)?.transcript?.activeTurn ?? null)).toContain(
      'hello'
    );
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
        used: 42000,
        size: 200000,
        cost: { amount: 0.25, currency: 'USD' },
      } as SessionUpdate,
    });
    expect(peek(live.states.usage)).toEqual({
      contextUsed: 42000,
      contextSize: 200000,
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
    const started = await rt.startSession(
      makeStartInput({ conversationId: 'conv-attachment' }),
      'resume'
    );
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

    const history = await startAndLoadHistory(rt, 'conv-attachment');
    expect(isOk(history)).toBe(true);
    if (!isOk(history) || history.data.kind !== 'available')
      throw new Error('Expected available history');
    expect(history.data.turns[0].items[0]).toMatchObject({
      kind: 'message',
      text: 'look',
      attachments: [{ id: 'attachment-1', name: 'image.png', mimeType: 'image/png' }],
    });
  });
  it('sends hidden prompt context to the agent without adding it to the transcript', async () => {
    const h = makeAcpHarness();
    const rt = new AcpRuntime(h.deps);
    const started = await rt.startSession(
      makeStartInput({ conversationId: 'conv-hidden-context' }),
      'resume'
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

    const history = await startAndLoadHistory(rt, 'conv-hidden-context');
    expect(isOk(history)).toBe(true);
    if (!isOk(history) || history.data.kind !== 'available')
      throw new Error('Expected available history');
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
        new Promise<{
          stopReason: 'end_turn';
        }>((resolve) => {
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
        new Promise<{
          stopReason: 'end_turn';
        }>((resolve) => {
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
    const result = await startAndLoadHistory(rt, input.conversationId);

    expect(isOk(result)).toBe(true);
    if (!isOk(result) || result.data.kind !== 'available')
      throw new Error('Expected available history');
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
  it('passes the session environment to ACP-created terminals', async () => {
    const h = makeAcpHarness();
    const rt = new AcpRuntime(h.deps);
    const result = await rt.startSession(
      makeStartInput({
        conversationId: 'conv-terminal-env',
        env: { ENV_TEST: 'this-is-a-test' },
      }),
      'resume'
    );
    expect(isOk(result)).toBe(true);
    await h.client().createTerminal!({
      sessionId: 'session-1',
      command: 'echo',
      args: ['$ENV_TEST'],
      cwd: '/tmp',
    });
    expect(h.fakeHost.spawnTerminalFn).toHaveBeenCalledWith(
      expect.objectContaining({ env: expect.objectContaining({ ENV_TEST: 'this-is-a-test' }) })
    );
  });
  it('adapts provider terminal commands at the connection boundary', async () => {
    const agent = new FakeAcpAgent();
    const h = makeAcpHarness({
      acpBehavior: {
        buildSpawn: () => ({ command: '/fake/agent', args: [] }),
        connect: agent.behavior.connect,
        terminalCommand: ({ command }) => ({ kind: 'shell-line', commandLine: command }),
      },
    });
    const rt = new AcpRuntime(h.deps);
    try {
      await rt.startSession(makeStartInput(), 'resume');
      await agent.capturedClient!.createTerminal!({
        sessionId: 'session-1',
        command: 'ls && ls src',
      });
      expect(h.fakeHost.spawnTerminalFn).toHaveBeenCalledWith(
        expect.objectContaining({
          command: { kind: 'shell-line', commandLine: 'ls && ls src' },
        })
      );
    } finally {
      await rt.dispose();
    }
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

    await rt.startSession(makeStartInput({ conversationId: 'conv-a' }), 'resume');
    await rt.startSession(makeStartInput({ conversationId: 'conv-b' }), 'resume');
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

    await rt.startSession(makeStartInput({ conversationId: 'conv-fresh' }), 'resume');

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

    await rt.startSession(
      {
        ...makeStartInput({ conversationId: 'conv-resume' }),
        sessionId: 'session-old',
      },
      'resume'
    );

    expect(reports.started).toEqual([
      { conversationId: 'conv-resume', providerSessionId: 'session-old', resumeOutcome: 'loaded' },
    ]);
  });
  it.each(['attach', 'launch'] as const)(
    'preserves the saved session after failed %s and retries the original session',
    async (start) => {
      const reports = createRecordingConversationLifecycleReporter();
      const intents = createMemorySessionIntentStore();
      const h = makeAcpHarness({ conversationReports: reports, intents });
      const rt = new AcpRuntime(h.deps);
      const input = makeStartInput({ conversationId: 'conv-restore', sessionId: 'session-old' });
      h.agent.loadSession.mockRejectedValueOnce(new Error('temporary provider failure'));
      if (start === 'attach') await rt.attachSession(input);
      try {
        const failed =
          start === 'attach'
            ? startAndLoadHistory(rt, input.conversationId)
            : rt.startSession(input, 'resume');
        await expect(failed).resolves.toMatchObject({ success: false });
        expect(h.agent.newSession).not.toHaveBeenCalled();
        expect(reports.started).toEqual([]);
        expect(intents.snapshot()[0]?.sessionId).toBe('session-old');
        await expect(startAndLoadHistory(rt, input.conversationId)).resolves.toMatchObject({
          success: true,
        });
        expect(h.agent.loadSession.mock.calls.map(([request]) => request.sessionId)).toEqual([
          'session-old',
          'session-old',
        ]);
        expect(reports.started).toEqual([
          {
            conversationId: input.conversationId,
            providerSessionId: 'session-old',
            resumeOutcome: 'loaded',
          },
        ]);
      } finally {
        await rt.dispose();
      }
    }
  );
  it('waits for the provider close acknowledgement before restoring history', async () => {
    const { h, rt, conversationId } = await launchHarness('conv-close-barrier');
    const closing = deferred<void>();
    h.agent.closeSession.mockImplementationOnce(() => closing.promise);
    h.agent.loadSession.mockImplementationOnce(async () => {
      await h.client().sessionUpdate({
        sessionId: 'session-1',
        update: {
          sessionUpdate: 'user_message_chunk',
          content: { type: 'text', text: 'original question' },
        },
      });
      await h.client().sessionUpdate({
        sessionId: 'session-1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'original answer' },
        },
      });
      return {};
    });
    let stopped = false;
    const stop = rt.stopSession(conversationId).then(() => {
      stopped = true;
    });
    await vi.waitFor(() => expect(h.agent.closeSession).toHaveBeenCalledOnce());
    const history = startAndLoadHistory(rt, conversationId);
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(stopped).toBe(false);
      expect(h.agent.loadSession).not.toHaveBeenCalled();
      closing.resolve();
      await stop;
      await expect(history).resolves.toMatchObject({
        success: true,
        data: { turns: [expect.anything()] },
      });
      expect(h.agent.newSession).toHaveBeenCalledOnce();
    } finally {
      closing.resolve();
      await Promise.all([stop, history]);
      await rt.dispose();
    }
  });
  it('keeps restoration blocked after a close timeout until the provider acknowledges it', async () => {
    const clock = createManualClock();
    const h = makeAcpHarness({ clock, lifecycle: { activationDrainTimeoutMs: 100 } });
    const rt = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'conv-close-timeout' });
    await rt.startSession(input, 'resume');
    const closing = deferred<void>();
    h.agent.closeSession.mockImplementationOnce(() => closing.promise);
    try {
      const stop = rt.stopSession(input.conversationId);
      await vi.waitFor(() => expect(h.agent.closeSession).toHaveBeenCalledOnce());
      await clock.advanceBy(101);
      await stop;
      const history = startAndLoadHistory(rt, input.conversationId);
      await new Promise<void>((resolve) => setImmediate(resolve));
      await clock.advanceBy(101);
      await expect(history).resolves.toMatchObject({ success: false });
      expect(h.agent.loadSession).not.toHaveBeenCalled();
      expect(h.agent.newSession).toHaveBeenCalledOnce();
      closing.resolve();
      await expect(startAndLoadHistory(rt, input.conversationId)).resolves.toMatchObject({
        success: true,
      });
      expect(h.agent.loadSession).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'session-1' })
      );
    } finally {
      closing.resolve();
      await rt.dispose();
    }
  });
  it('retries a rejected close before resuming the original session', async () => {
    const { h, rt, conversationId } = await launchHarness('conv-close-rejected');
    h.agent.closeSession.mockRejectedValueOnce(new Error('temporary close failure'));
    try {
      await rt.stopSession(conversationId);
      await expect(startAndLoadHistory(rt, conversationId)).resolves.toMatchObject({
        success: true,
      });
      expect(h.agent.closeSession).toHaveBeenCalledTimes(2);
      expect(h.agent.loadSession).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'session-1' })
      );
      expect(h.agent.newSession).toHaveBeenCalledOnce();
    } finally {
      await rt.dispose();
    }
  });
  it('releases a timed-out close barrier when its provider process exits', async () => {
    const clock = createManualClock();
    const h = makeAcpHarness({ clock, lifecycle: { activationDrainTimeoutMs: 100 } });
    const rt = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'conv-close-exited' });
    await rt.startSession(input, 'resume');
    const closing = deferred<void>();
    h.agent.closeSession.mockImplementationOnce(() => closing.promise);
    try {
      const stop = rt.stopSession(input.conversationId);
      await vi.waitFor(() => expect(h.agent.closeSession).toHaveBeenCalledOnce());
      await clock.advanceBy(101);
      await stop;
      h.lastChild.emitExit(1);
      await vi.waitFor(() =>
        expect(
          rt.connections.peek({ providerId: input.providerId, cwd: input.cwd, env: input.env })
        ).toBeUndefined()
      );
      await expect(startAndLoadHistory(rt, input.conversationId)).resolves.toMatchObject({
        success: true,
      });
      expect(h.children).toHaveLength(2);
      expect(h.agent.loadSession).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'session-1' })
      );
      expect(h.agent.newSession).toHaveBeenCalledOnce();
    } finally {
      closing.resolve();
      await rt.dispose();
    }
  });
  it('does not replace saved sessions when the provider cannot load history', async () => {
    const h = makeAcpHarness();
    h.agent.initialize.mockResolvedValueOnce({
      protocolVersion: 1,
      agentCapabilities: { loadSession: false },
    });
    const rt = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'conv-no-history', sessionId: 'original' });
    await rt.attachSession(input);
    try {
      await expect(startAndLoadHistory(rt, input.conversationId)).resolves.toMatchObject({
        success: false,
      });
      expect(h.agent.newSession).not.toHaveBeenCalled();
    } finally {
      await rt.dispose();
    }
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

    await rt.startSession(
      {
        ...makeStartInput({ conversationId: 'conv-rebind' }),
        sessionId: 'session-old',
      },
      'resume'
    );

    expect(reports.providerIds).toEqual([]);
    expect(reports.started).toEqual([
      {
        conversationId: 'conv-rebind',
        providerSessionId: 'session-rebound',
        resumeOutcome: 'loaded',
      },
    ]);
  });
  it('reports session end exactly once on user stop', async () => {
    const reports = createRecordingConversationLifecycleReporter();
    const h = makeAcpHarness({ conversationReports: reports });
    const rt = new AcpRuntime(h.deps);
    await rt.startSession(makeStartInput({ conversationId: 'conv-stop' }), 'resume');

    await rt.stopSession('conv-stop');
    expect(reports.ended).toEqual(['conv-stop']);
    expect(rt.manager.inspect().running).not.toContain('conv-stop');
    expect(rt.manager.inspect().retained).toContain('conv-stop');
  });
  it('reports session end exactly once when the provider process dies', async () => {
    const reports = createRecordingConversationLifecycleReporter();
    const h = makeAcpHarness({ conversationReports: reports });
    const rt = new AcpRuntime(h.deps);
    await rt.startSession(makeStartInput({ conversationId: 'conv-died' }), 'resume');

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
  it('starts a fresh env-keyed provider process after the previous process dies', async () => {
    const h = makeAcpHarness();
    const rt = new AcpRuntime(h.deps);
    const input = makeStartInput({
      conversationId: 'conv-env-restart',
      env: { ENV_TEST: 'this-is-a-test' },
    });
    await rt.startSession(input, 'resume');

    h.lastChild.emitExit(42);
    await vi.waitFor(() =>
      expect(peek(rt.sessionLiveModels(input.conversationId)!.states.state)).toMatchObject({
        suspended: true,
      })
    );

    await rt.startSession(input, 'resume');

    expect(h.children).toHaveLength(2);
  });
  it('suspends the persisted intent when the provider process dies', async () => {
    const intents = createMemorySessionIntentStore();
    const h = makeAcpHarness({ intents });
    const rt = new AcpRuntime(h.deps);
    await rt.startSession(makeStartInput({ conversationId: 'conv-crash' }), 'resume');
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

    const result = await rt.startSession(
      makeStartInput({ conversationId: 'conv-start-fail' }),
      'resume'
    );

    expect(result.success).toBe(false);
    expect(reports.ended).toEqual(['conv-start-fail']);
    expectNoSessionResidue('conv-start-fail', leakContainers(rt));
  });
  it('retains a usable pooled connection for retry after a failed load', async () => {
    const h = makeAcpHarness();
    const rt = new AcpRuntime(h.deps);
    h.agent.loadSession.mockRejectedValueOnce(new Error('temporary failure'));
    const input = makeStartInput({ conversationId: 'conv-lease', sessionId: 'session-old' });
    await rt.attachSession(input);
    try {
      await expect(startAndLoadHistory(rt, input.conversationId)).resolves.toMatchObject({
        success: false,
      });
      await expect(startAndLoadHistory(rt, input.conversationId)).resolves.toMatchObject({
        success: true,
      });
      expect(h.children).toHaveLength(1);
      expect(h.lastChild.kill).not.toHaveBeenCalled();
      expect(h.agent.newSession).not.toHaveBeenCalled();
    } finally {
      await rt.dispose();
    }
  });
  it('reuses the provider connection when retrying a failed restoration', async () => {
    const h = makeAcpHarness();
    const rt = new AcpRuntime(h.deps);
    h.agent.loadSession.mockRejectedValueOnce(new Error('session is closing'));
    const input = { ...makeStartInput({ conversationId: 'conv-lease' }), sessionId: 'session-old' };
    expect((await rt.startSession(input, 'resume')).success).toBe(false);
    expect((await rt.startSession(input, 'resume')).success).toBe(true);
    expect(h.agent.newSession).not.toHaveBeenCalled();
    expect(h.children).toHaveLength(1);
    expect(h.lastChild.kill).not.toHaveBeenCalled();
    expect(rt.sessionLiveModels('conv-lease')).not.toBeNull();
    await rt.dispose();
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
function collaborationModeConfigOption(currentValue: string) {
  return {
    id: 'collaboration_mode',
    name: 'Collaboration mode',
    category: 'collaboration_mode',
    type: 'select',
    currentValue,
    options: [
      { value: 'default', name: 'Default' },
      { value: 'plan', name: 'Plan' },
    ],
  };
}

async function startAndLoadHistory(runtime: AcpRuntime, conversationId: string) {
  const started = await runtime.startSession(makeStartInput({ conversationId }), 'resume');
  return started.success ? runtime.loadHistory(conversationId) : started;
}

describe('provider-native option persistence', () => {
  it('persists an accepted selection when reapplying another saved option fails', async () => {
    const intents = createMemorySessionIntentStore();
    const h = makeAcpHarness({ intents });
    let model = 'a';
    let effort = 'high';
    let mode = 'agent-full-access';
    let rejectEffort = true;
    const options = () => [
      {
        ...modelConfigOption(model),
        options: ['a', 'b'].map((value) => ({ value, name: value })),
      },
      effortConfigOption(effort),
      modeConfigOption(mode),
    ];
    h.agent.newSession.mockImplementation(async () => ({
      sessionId: 'session-1',
      configOptions: options(),
    }));
    h.agent.loadSession.mockImplementation(async () => ({ configOptions: options() }));
    h.agent.setSessionConfigOption.mockImplementation(async ({ configId, value }) => {
      if (configId === 'model') {
        model = String(value);
        effort = 'low';
        mode = 'agent';
      }
      if (configId === 'reasoning_effort') {
        if (rejectEffort) throw new Error('effort temporarily unavailable');
        effort = String(value);
      }
      if (configId === 'mode') mode = String(value);
      return { configOptions: options() };
    });
    const runtime = new AcpRuntime(h.deps);
    const input = makeStartInput({
      options: { model: 'a', reasoning_effort: 'high', mode: 'agent-full-access' },
    });
    try {
      expect((await runtime.startSession(input, 'resume')).success).toBe(true);
      const result = await runtime.setOption(input.conversationId, 'model', 'b');
      expect(model).toBe('b');
      expect(peek(runtime.sessionLiveModels(input.conversationId)!.states.config)).toMatchObject({
        configuredOptions: { model: 'b', reasoning_effort: 'high', mode: 'agent-full-access' },
      });
      expect(result).toMatchObject({
        success: true,
        data: {
          reapplyFailures: [
            {
              configId: 'reasoning_effort',
              error: {
                type: 'set_config_failed',
                cause: { message: 'effort temporarily unavailable' },
              },
            },
          ],
        },
      });
      expect(mode).toBe('agent-full-access');
      await vi.waitFor(() =>
        expect(intents.snapshot()[0]?.payload).toMatchObject({
          configured: {
            options: { model: 'b', reasoning_effort: 'high', mode: 'agent-full-access' },
          },
        })
      );
      await runtime.stopSession(input.conversationId);
      rejectEffort = false;
      expect(await runtime.sendPrompt(input.conversationId, { text: 'resume' })).toMatchObject({
        success: true,
      });
      expect([model, effort, mode]).toEqual(['b', 'high', 'agent-full-access']);
      expect(h.agent.newSession).toHaveBeenCalledOnce();
    } finally {
      await runtime.dispose();
    }
  });

  it('leaves provider configuration untouched when there are no saved choices', async () => {
    const h = makeAcpHarness();
    h.agent.newSession.mockResolvedValue({
      sessionId: 'session-1',
      configOptions: [modelConfigOption('available')],
    });
    const runtime = new AcpRuntime(h.deps);
    try {
      expect((await runtime.startSession(makeStartInput({ options: {} }), 'resume')).success).toBe(
        true
      );
      expect(h.agent.setSessionConfigOption).not.toHaveBeenCalled();
      expect(peek(runtime.sessionLiveModels('conv-1')!.states.config)?.configuredOptions).toEqual(
        {}
      );
    } finally {
      await runtime.dispose();
    }
  });
  it('applies model before its dependent effort and before the initial prompt', async () => {
    const h = makeAcpHarness();
    let model = 'a';
    let effort = 'medium';
    const options = () => [
      {
        id: 'native-model',
        name: 'Model',
        category: 'model',
        type: 'select' as const,
        currentValue: model,
        options: ['a', 'b'].map((value) => ({ value, name: value })),
      },
      {
        id: 'native-effort',
        name: 'Effort',
        category: 'thought_level',
        type: 'select' as const,
        currentValue: effort,
        options: (model === 'b' ? ['medium', 'xhigh'] : ['medium']).map((value) => ({
          value,
          name: value,
        })),
      },
    ];
    h.agent.newSession.mockResolvedValue({ sessionId: 'native-session', configOptions: options() });
    h.agent.setSessionConfigOption.mockImplementation(async ({ configId, value }) => {
      if (configId === 'native-model') model = String(value);
      if (configId === 'native-effort') {
        expect(model).toBe('b');
        effort = String(value);
      }
      return { configOptions: options() };
    });
    h.agent.prompt.mockImplementation(async () => {
      expect([model, effort]).toEqual(['b', 'xhigh']);
      return { stopReason: 'end_turn' };
    });
    const runtime = new AcpRuntime(h.deps);
    const result = await runtime.startSession(
      makeStartInput({
        options: { 'native-effort': 'xhigh', 'native-model': 'b' },
        initialQueue: [{ text: 'start' }],
      }),
      'resume'
    );
    expect(result.success).toBe(true);
    await vi.waitFor(() => expect(h.agent.prompt).toHaveBeenCalledOnce());
    expect(h.agent.setSessionConfigOption.mock.calls.map(([input]) => input.configId)).toEqual([
      'native-model',
      'native-effort',
    ]);
    await runtime.dispose();
  });
  it('does not let a stale attachment undo explicit dormant choices', async () => {
    const h = makeAcpHarness();
    const runtime = new AcpRuntime(h.deps);
    const input = makeStartInput({ options: { model: 'stale-model' } });
    expect((await runtime.attachSession(input)).success).toBe(true);
    expect((await runtime.setOption(input.conversationId, 'model', 'default')).success).toBe(true);
    expect((await runtime.setOption(input.conversationId, 'effort', 'xhigh')).success).toBe(true);
    expect((await runtime.attachSession(input)).success).toBe(true);
    expect(
      peek(runtime.sessionLiveModels(input.conversationId)!.states.config)?.configuredOptions
    ).toEqual({ model: 'default', effort: 'xhigh' });
    expect(h.agent.newSession).not.toHaveBeenCalled();
    await runtime.dispose();
  });
  it('applies a newer selection received while the initial settings are applying', async () => {
    const h = makeAcpHarness();
    let selected = 'default-model';
    const options = () => [
      {
        id: 'model',
        name: 'Model',
        category: 'model',
        type: 'select' as const,
        currentValue: selected,
        options: ['default-model', 'chosen-model'].map((value) => ({ value, name: value })),
      },
    ];
    h.agent.newSession.mockResolvedValue({ sessionId: 'native-session', configOptions: options() });
    const runtime = new AcpRuntime(h.deps);
    const input = makeStartInput({
      options: { model: 'chosen-model' },
      initialQueue: [{ text: 'start' }],
    });
    h.agent.setSessionConfigOption.mockImplementation(async ({ value }) => {
      selected = String(value);
      if (value === 'chosen-model')
        await runtime.setOption(input.conversationId, 'model', 'default-model');
      return { configOptions: options() };
    });
    h.agent.prompt.mockImplementation(async () => {
      expect(selected).toBe('default-model');
      return { stopReason: 'end_turn' };
    });
    expect((await runtime.startSession(input, 'resume')).success).toBe(true);
    await vi.waitFor(() => expect(h.agent.prompt).toHaveBeenCalledOnce());
    expect(h.agent.setSessionConfigOption.mock.calls.map(([input]) => input.value)).toEqual([
      'chosen-model',
      'default-model',
    ]);
    await runtime.dispose();
  });
  it('publishes invalid overrides for conditional cleanup and runs with provider defaults', async () => {
    const h = makeAcpHarness();
    h.agent.newSession.mockResolvedValue({
      sessionId: 'session-1',
      configOptions: [modelConfigOption('available')],
    });
    const runtime = new AcpRuntime(h.deps);
    const input = makeStartInput({ options: { model: 'removed' } });
    expect((await runtime.startSession(input, 'resume')).success).toBe(true);
    expect(h.agent.setSessionConfigOption).not.toHaveBeenCalled();
    expect(peek(runtime.sessionLiveModels(input.conversationId)!.states.config)).toMatchObject({
      configuredOptions: {},
      clearedOptions: { model: 'removed' },
    });
    await runtime.dispose();
  });
  it('does not submit a prompt or erase a preference when an option setter fails', async () => {
    const h = makeAcpHarness();
    h.agent.newSession.mockResolvedValue({
      sessionId: 'session-1',
      configOptions: [modelConfigOption('available')],
    });
    h.agent.setSessionConfigOption.mockRejectedValue(new Error('connection interrupted'));
    const runtime = new AcpRuntime(h.deps);
    const input = makeStartInput({
      options: { model: 'supported-model' },
      initialQueue: [{ text: 'must wait' }],
    });
    expect((await runtime.startSession(input, 'resume')).success).toBe(false);
    expect(h.agent.prompt).not.toHaveBeenCalled();
    await runtime.dispose();
  });
});
