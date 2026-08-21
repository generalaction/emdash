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
  mapContainer,
  type LeakCheckContainer,
} from '#services/session-lifecycle/node/testing';
import { AcpRuntime } from './runtime';

async function startHarness(conversationId = 'conv-1') {
  const h = makeAcpHarness();
  const rt = new AcpRuntime(h.deps);
  const result = await rt.startSession(makeStartInput({ conversationId }));
  expect(isOk(result)).toBe(true);
  return { h, rt, client: h.client(), sessionId: 'session-1', conversationId };
}

function liveValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected live projection value');
  return value;
}

describe('AcpRuntime session manager', () => {
  it('maps ACP auth_required JSON-RPC errors to auth_required', async () => {
    const h = makeAcpHarness();
    const rt = new AcpRuntime(h.deps);
    h.agent.newSession.mockRejectedValueOnce({ code: -32000, message: 'Authentication required' });

    const result = await rt.startSession(makeStartInput({ conversationId: 'conv-auth-required' }));

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

    await rt.startSession(makeStartInput({ conversationId: 'conv-a' }));
    await rt.startSession(makeStartInput({ conversationId: 'conv-b' }));

    expect(h.children).toHaveLength(1);
    await rt.stopSession('conv-a');
    expect(h.lastChild.kill).not.toHaveBeenCalled();
    await rt.stopSession('conv-b');
    await clock.advanceBy(500);
    await vi.waitFor(() => {
      expect(h.lastChild.kill).toHaveBeenCalledWith('SIGTERM');
    });
  });

  it('coalesces concurrent starts into one activation and one provider session', async () => {
    const pendingSession = deferred<{ sessionId: string }>();
    const h = makeAcpHarness({ lifecycle: { connectionIdleTtlMs: 0 } });
    h.agent.newSession.mockImplementationOnce(async () => pendingSession.promise);
    const rt = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'conv-concurrent' });

    const first = rt.startSession(input);
    const second = rt.startSession(input);
    await vi.waitFor(() => expect(h.agent.newSession).toHaveBeenCalledTimes(1));
    expect(h.children).toHaveLength(1);

    pendingSession.resolve({ sessionId: 'session-shared' });
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toEqual(secondResult);
    expect(firstResult).toMatchObject({
      success: true,
      data: { sessionId: 'session-shared', activationId: expect.any(String) },
    });
    await rt.stopSession('conv-concurrent');
    expectNoSessionResidue('conv-concurrent', leakContainers(rt));
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
    const started = await rt.startSession(makeStartInput({ conversationId: 'conv-idle' }));
    if (!started.success) throw new Error('expected ACP activation');
    const live = rt.sessionLiveModels('conv-idle');
    if (!live) throw new Error('expected stable live projection');
    const scope = createScope({ label: 'test:idle-projection' });
    const lifecycles: string[] = [];
    observe(live.states.state, (snapshot) => lifecycles.push(liveValue(snapshot.value).lifecycle), {
      scope,
    });

    await clock.advanceBy(1_200);
    await rt.manager.sweepNow();

    expect(peek(rt.sessionsLiveHost().get(undefined)!.states.list)).toEqual({});
    expect(rt.sessionLiveModels('conv-idle')).toBe(live);
    expect(peek(live.states.activationId)).toBeNull();
    expect(liveValue(peek(live.states.state)).lifecycle).toBe('closed');
    expect(lifecycles).toContain('closed');
    const inactivePrompt = await rt.sendPrompt('conv-idle', { text: 'after eviction' });
    expect(inactivePrompt).toMatchObject({
      success: false,
      error: { type: 'activation_missing' },
    });

    await clock.advanceBy(500);
    expect(h.lastChild.kill).toHaveBeenCalledWith('SIGTERM');
    await scope.dispose();
  });

  it('rewrites the same projection when a conversation is rematerialized', async () => {
    const clock = createManualClock(0);
    const h = makeAcpHarness({
      clock,
      lifecycle: {
        session: { kind: 'idle-after', outputMs: 1_000 },
        sweepIntervalMs: 10_000,
      },
    });
    const rt = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'conv-rematerialize' });
    const first = await rt.startSession(input);
    if (!first.success) throw new Error('expected first activation');
    const live = rt.sessionLiveModels(input.conversationId);
    if (!live) throw new Error('expected stable live projection');

    await clock.advanceBy(1_200);
    await rt.manager.sweepNow();
    expect(peek(live.states.activationId)).toBeNull();

    h.agent.newSession.mockResolvedValueOnce({ sessionId: 'session-2' });
    const second = await rt.startSession(input);
    if (!second.success) throw new Error('expected replacement activation');

    expect(rt.sessionLiveModels(input.conversationId)).toBe(live);
    expect(second.data.activationId).not.toBe(first.data.activationId);
    expect(peek(live.states.activationId)).toBe(second.data.activationId);
    expect(liveValue(peek(live.states.state)).lifecycle).toBe('ready');
  });

  it('holds activation teardown until a leased provider operation completes', async () => {
    const promptDeferred = deferred<{ stopReason: 'end_turn' }>();
    const h = makeAcpHarness();
    h.agent.prompt.mockImplementationOnce(async () => promptDeferred.promise);
    const rt = new AcpRuntime(h.deps);
    await rt.startSession(makeStartInput({ conversationId: 'conv-leased-prompt' }));
    const live = rt.sessionLiveModels('conv-leased-prompt');
    if (!live) throw new Error('expected stable live projection');

    const prompt = rt.sendPrompt('conv-leased-prompt', { text: 'hold activation' });
    await vi.waitFor(() => expect(h.agent.prompt).toHaveBeenCalledTimes(1));
    const stop = rt.stopSession('conv-leased-prompt');
    let stopSettled = false;
    void stop.then(() => {
      stopSettled = true;
    });
    await Promise.resolve();

    expect(stopSettled).toBe(false);
    expect(h.agent.closeSession).not.toHaveBeenCalled();
    expect(peek(live.states.activationId)).not.toBeNull();

    promptDeferred.resolve({ stopReason: 'end_turn' });
    await prompt;
    await stop;
    expect(h.agent.closeSession).toHaveBeenCalledTimes(1);
    expect(peek(live.states.activationId)).toBeNull();
    expect(liveValue(peek(live.states.state)).lifecycle).toBe('closed');
  });

  it('waits for full eviction before starting a replacement activation', async () => {
    const promptDeferred = deferred<{ stopReason: 'end_turn' }>();
    const h = makeAcpHarness();
    h.agent.prompt.mockImplementationOnce(async () => promptDeferred.promise);
    const rt = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'conv-stop-start' });
    const first = await rt.startSession(input);
    if (!first.success) throw new Error('expected first activation');

    const prompt = rt.sendPrompt(input.conversationId, { text: 'hold activation' });
    await vi.waitFor(() => expect(h.agent.prompt).toHaveBeenCalledTimes(1));
    const stop = rt.stopSession(input.conversationId);
    h.agent.newSession.mockResolvedValueOnce({ sessionId: 'session-2' });
    const restart = rt.startSession(input);
    let restartSettled = false;
    void restart.then(() => {
      restartSettled = true;
    });
    await Promise.resolve();

    expect(restartSettled).toBe(false);
    expect(h.agent.newSession).toHaveBeenCalledTimes(1);

    promptDeferred.resolve({ stopReason: 'end_turn' });
    await prompt;
    await stop;
    const second = await restart;
    if (!second.success) throw new Error('expected replacement activation');
    expect(second.data.sessionId).toBe('session-2');
    expect(second.data.activationId).not.toBe(first.data.activationId);
  });

  it('ignores a late close callback from an older process generation', async () => {
    const h = makeAcpHarness({ lifecycle: { connectionIdleTtlMs: 0 } });
    const rt = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'conv-generation' });
    const first = await rt.startSession(input);
    if (!first.success) throw new Error('expected first activation');
    await rt.stopSession(input.conversationId);

    h.agent.newSession.mockResolvedValueOnce({ sessionId: 'session-2' });
    const second = await rt.startSession(input);
    if (!second.success) throw new Error('expected replacement activation');
    rt.manager.onProcessClosed('claude:/tmp/workspace', 1, 42);

    expect(rt.getSessionState(input.conversationId).lifecycle).toBe('ready');
    expect(peek(rt.sessionLiveModels(input.conversationId)!.states.activationId)).toBe(
      second.data.activationId
    );
  });

  it('rejects commands fenced to a replaced activation', async () => {
    const h = makeAcpHarness();
    const rt = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'conv-stale-command' });
    const first = await rt.startSession(input);
    if (!first.success) throw new Error('expected first activation');
    await rt.stopSession(input.conversationId);
    h.agent.newSession.mockResolvedValueOnce({ sessionId: 'session-2' });
    const second = await rt.startSession(input);
    if (!second.success) throw new Error('expected replacement activation');
    h.agent.prompt.mockClear();

    const result = await rt.sendPrompt(
      input.conversationId,
      { text: 'do not replay' },
      undefined,
      input,
      first.data.activationId
    );

    expect(result).toMatchObject({ success: false, error: { type: 'stale_activation' } });
    expect(h.agent.prompt).not.toHaveBeenCalled();
    expect(peek(rt.sessionLiveModels(input.conversationId)!.states.activationId)).toBe(
      second.data.activationId
    );
  });

  it('rejects fenced operations before materializing an evicted activation', async () => {
    const h = makeAcpHarness({ lifecycle: { connectionIdleTtlMs: 0 } });
    const rt = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'conv-evicted-fence' });
    const started = await rt.startSession(input);
    if (!started.success) throw new Error('expected activation');
    await rt.stopSession(input.conversationId);
    h.agent.newSession.mockClear();
    const processCount = h.children.length;

    const prompt = await rt.sendPrompt(
      input.conversationId,
      { text: 'must not restart' },
      undefined,
      input,
      started.data.activationId
    );
    const model = await rt.setModelOption(
      input.conversationId,
      'model',
      'replacement-model',
      input,
      started.data.activationId
    );

    expect(prompt).toMatchObject({ success: false, error: { type: 'activation_missing' } });
    expect(model).toMatchObject({ success: false, error: { type: 'activation_missing' } });
    expect(h.agent.newSession).not.toHaveBeenCalled();
    expect(h.children).toHaveLength(processCount);
    expect([...managerInternals(rt).activations.keys()]).toEqual([]);
  });

  it('reconciles legacy session intents and strips desktop identifiers', async () => {
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
        sessionId: 'session-old',
      },
    });
    const h = makeAcpHarness({ intents });
    const rt = new AcpRuntime(h.deps);

    await rt.reconcile();

    expect(h.agent.loadSession).toHaveBeenCalledWith({
      cwd: '/tmp/workspace',
      sessionId: 'session-old',
      mcpServers: [],
    });
    expect(peek(rt.sessionsLiveHost().get(undefined)!.states.list)).toHaveProperty(
      'conv-reconcile'
    );
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

    const result = await rt.startSession(makeStartInput({ conversationId: 'conv-mcp' }));

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

    const result = await rt.resumeSession({
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

    const result = await rt.startSession(
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

    const result = await rt.resumeSession({
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

    const result = await rt.startSession(
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

    const result = await rt.startSession(
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

    const result = await rt.startSession(
      makeStartInput({ conversationId: 'conv-mode-error', modeId: 'agent-full-access' })
    );

    expect(isOk(result)).toBe(true);
  });

  it('persists the current resume input without desktop identifiers', async () => {
    const intents = createMemorySessionIntentStore();
    const h = makeAcpHarness({ intents });
    const rt = new AcpRuntime(h.deps);

    await rt.startSession(makeStartInput({ conversationId: 'conv-persisted' }));

    await vi.waitFor(() => expect(intents.snapshot()).toHaveLength(1));
    expect(intents.snapshot()[0]?.payload).toEqual({
      conversationId: 'conv-persisted',
      providerId: 'claude',
      cwd: '/tmp/workspace',
      sessionId: 'session-1',
      model: null,
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
    await rt.startSession(makeStartInput({ conversationId: 'conv-idle-intent' }));

    await clock.advanceBy(1_200);
    await rt.manager.sweepNow();

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
    await rt.startSession(makeStartInput({ conversationId: 'conv-kill' }));

    await vi.waitFor(() => expect(intents.snapshot()).toHaveLength(1));
    await rt.killSession('conv-kill');

    await vi.waitFor(() => expect(intents.snapshot()).toEqual([]));
    expectNoSessionResidue('conv-kill', leakContainers(rt));
  });

  it('publishes activeTurn patches without root replacement during incremental text growth', async () => {
    const { h, rt, client, sessionId } = await startHarness('conv-live');
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
    await vi.waitFor(() => expect(resolvePrompt).toBeTypeOf('function'));
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

  it('does not republish the sessions list when only transcript content changes', async () => {
    const clock = createManualClock(100);
    const h = makeAcpHarness({ clock });
    const rt = new AcpRuntime(h.deps);
    await rt.startSession(makeStartInput({ conversationId: 'conv-summary-churn' }));
    const client = h.client();
    const list = rt.sessionsListLiveModel().states.list;

    await client.sessionUpdate({
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        sessionId: 'session-1',
        messageId: 'msg-1',
        content: { type: 'text', text: 'one' },
      } as SessionUpdate,
    });
    const afterFirstChunk = peek(list);
    const firstSummary = afterFirstChunk['conv-summary-churn'];

    await client.sessionUpdate({
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        sessionId: 'session-1',
        messageId: 'msg-1',
        content: { type: 'text', text: 'two' },
      } as SessionUpdate,
    });

    expect(peek(list)).toBe(afterFirstChunk);
    expect(peek(list)['conv-summary-churn']).toBe(firstSummary);
  });

  it('publishes usage updates through live models', async () => {
    const { rt, client, sessionId } = await startHarness('conv-usage');
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
    const started = await rt.startSession(makeStartInput({ conversationId: 'conv-attachment' }));
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

    const history = await rt.getHistory('conv-attachment');
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
    const started = await rt.startSession(
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

    const history = await rt.getHistory('conv-hidden-context');
    expect(isOk(history)).toBe(true);
    if (!isOk(history)) return;
    expect(history.data.turns[0].items[0]).toMatchObject({
      kind: 'message',
      text: 'Fix @[ENG-123](issue:linear:ENG-123)',
    });
    expect(JSON.stringify(history.data.turns[0].items[0])).not.toContain('Context body');
  });

  it('delivers a prompt immediately with default placement when the session is idle', async () => {
    const { h, rt } = await startHarness('conv-placement-auto');

    const sent = await rt.sendPrompt('conv-placement-auto', { text: 'now' });

    expect(isOk(sent)).toBe(true);
    if (!isOk(sent)) return;
    expect(sent.data).toEqual({ queued: false });
    expect(h.agent.prompt).toHaveBeenCalledTimes(1);
    expect(rt.getSessionState('conv-placement-auto').queuedPrompts).toEqual([]);
  });

  it('queues a prompt with default placement while a turn is active', async () => {
    const { h, rt } = await startHarness('conv-placement-active');
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
    const { h, rt } = await startHarness('conv-placement-queue');

    const result = await rt.sendPrompt('conv-placement-queue', { text: 'later' }, 'queue');

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.data).toEqual({ queued: false });
    expect(h.agent.prompt).toHaveBeenCalledTimes(1);
    expect(rt.getSessionState('conv-placement-queue').queuedPrompts).toEqual([]);
  });

  it("keeps placement 'queue' queued while a turn is active", async () => {
    const { h, rt } = await startHarness('conv-placement-queue-active');
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

  it('returns a resume result with replayed history', async () => {
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

    const result = await rt.resumeSession({
      ...makeStartInput({ conversationId: 'conv-resume' }),
      sessionId: 'session-old',
    });

    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.data.sessionId).toBe('session-old');
    expect(result.data.turns).toHaveLength(1);
    expect(result.data.turns[0].items[0]).toMatchObject({
      kind: 'message',
      text: 'from history',
    });
  });

  it('publishes terminal state and output through live primitives', async () => {
    const { h, rt, client, sessionId } = await startHarness('conv-terminal');
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

  it('removes sessions when the process closes', async () => {
    const { h, rt } = await startHarness('conv-close');
    const live = rt.sessionLiveModels('conv-close');
    if (!live) throw new Error('expected live models');

    h.lastChild.emitExit(42);

    await vi.waitFor(() => expect(rt.getSessionState('conv-close').lifecycle).toBe('closed'));
    expect(rt.sessionLiveModels('conv-close')).toBe(live);
    expect(peek(live.states.activationId)).toBeNull();
    expect(peek(rt.sessionsListLiveModel().states.list)).toEqual({});
  });

  it('removes all sessions sharing a process when that process closes', async () => {
    const h = makeAcpHarness();
    const rt = new AcpRuntime(h.deps);
    h.agent.newSession
      .mockResolvedValueOnce({ sessionId: 'session-a' })
      .mockResolvedValueOnce({ sessionId: 'session-b' });

    await rt.startSession(makeStartInput({ conversationId: 'conv-a' }));
    await rt.startSession(makeStartInput({ conversationId: 'conv-b' }));
    expect(h.children).toHaveLength(1);

    h.lastChild.emitExit(42);

    await vi.waitFor(() => {
      expect(rt.getSessionState('conv-a').lifecycle).toBe('closed');
      expect(rt.getSessionState('conv-b').lifecycle).toBe('closed');
    });
    expect(peek(rt.sessionLiveModels('conv-a')!.states.activationId)).toBeNull();
    expect(peek(rt.sessionLiveModels('conv-b')!.states.activationId)).toBeNull();
    expect(peek(rt.sessionsListLiveModel().states.list)).toEqual({});
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

    await rt.startSession(makeStartInput({ conversationId: 'conv-fresh' }));

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

    await rt.resumeSession({
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

    const result = await rt.resumeSession({
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

    await rt.resumeSession({
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
    await rt.startSession(makeStartInput({ conversationId: 'conv-stop' }));

    await rt.stopSession('conv-stop');

    expect(reports.ended).toEqual(['conv-stop']);
    expectNoSessionResidue('conv-stop', leakContainers(rt));
  });

  it('reports session end exactly once when the provider process dies', async () => {
    const reports = createRecordingConversationLifecycleReporter();
    const h = makeAcpHarness({ conversationReports: reports });
    const rt = new AcpRuntime(h.deps);
    await rt.startSession(makeStartInput({ conversationId: 'conv-died' }));

    h.lastChild.emitExit(42);

    await vi.waitFor(() => {
      expect(reports.ended).toEqual(['conv-died']);
    });
    // The cell onClosed eviction and the process-close eviction coalesce.
    await vi.waitFor(() =>
      expect(peek(rt.sessionLiveModels('conv-died')!.states.activationId)).toBeNull()
    );
    expect(reports.ended).toEqual(['conv-died']);
    expectNoSessionResidue('conv-died', leakContainers(rt));
  });

  it('keeps the active intent when the provider process dies', async () => {
    const intents = createMemorySessionIntentStore();
    const h = makeAcpHarness({ intents });
    const rt = new AcpRuntime(h.deps);
    await rt.startSession(makeStartInput({ conversationId: 'conv-crash' }));
    await vi.waitFor(() => expect(intents.snapshot()).toHaveLength(1));

    h.lastChild.emitExit(42);

    await vi.waitFor(() =>
      expect(peek(rt.sessionLiveModels('conv-crash')!.states.activationId)).toBeNull()
    );
    expect(intents.snapshot()[0]).toMatchObject({
      conversationId: 'conv-crash',
      status: 'active',
    });
  });

  it('reports session end and cleans up when the start fails before a session exists', async () => {
    const reports = createRecordingConversationLifecycleReporter();
    const h = makeAcpHarness({ conversationReports: reports });
    const rt = new AcpRuntime(h.deps);
    h.agent.newSession.mockRejectedValueOnce(new Error('agent refused'));

    const result = await rt.startSession(makeStartInput({ conversationId: 'conv-start-fail' }));

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

    const result = await rt.resumeSession({
      ...makeStartInput({ conversationId: 'conv-lease' }),
      sessionId: 'session-old',
    });

    expect(isOk(result)).toBe(true);
    expect(h.children).toHaveLength(1);
    expect(h.lastChild.kill).not.toHaveBeenCalled();
    expect(rt.sessionLiveModels('conv-lease')).not.toBeNull();
  });
});

type ManagerInternals = {
  activations: { has(key: string): boolean; keys(): IterableIterator<string> };
  materializing: Map<string, unknown>;
  evictions: Map<string, Promise<void>>;
  routes: Map<string, Map<string, string>>;
  loadingConversations: Map<string, Set<string>>;
};

function managerInternals(rt: AcpRuntime): ManagerInternals {
  return rt.manager as unknown as ManagerInternals;
}

/** Reflects over the manager's per-key maps so the shared leak check can see them. */
function leakContainers(rt: AcpRuntime): LeakCheckContainer[] {
  const internals = managerInternals(rt);
  return [
    { name: 'activations', has: (key) => internals.activations.has(key) },
    mapContainer('materializing', internals.materializing),
    mapContainer('evictions', internals.evictions),
    {
      name: 'routes',
      has: (key) =>
        [...internals.routes.values()].some((bySession) => [...bySession.values()].includes(key)),
    },
    {
      name: 'loadingConversations',
      has: (key) => [...internals.loadingConversations.values()].some((set) => set.has(key)),
    },
    {
      name: 'sessionsList',
      has: (key) => key in peek(rt.sessionsListLiveModel().states.list),
    },
  ];
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
