import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { isOk, ok } from '@emdash/shared';
import { createManualClock } from '@emdash/shared/testing';
import {
  FakeAcpTerminalProcess,
  makeAcpHarness,
  makeStartInput,
} from '@runtimes/acp/node/acp-test-support';
import { createMemorySessionIntentStore } from '@services/session-intents/api';
import { describe, expect, it, vi } from 'vitest';
import { AcpRuntime } from './runtime';

async function startHarness(conversationId = 'conv-1') {
  const h = makeAcpHarness();
  const rt = new AcpRuntime(h.deps);
  const result = await rt.startSession(makeStartInput({ conversationId }));
  expect(isOk(result)).toBe(true);
  return { h, rt, client: h.client(), sessionId: 'session-1', conversationId };
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
    rt.stopSession('conv-a');
    expect(h.lastChild.kill).not.toHaveBeenCalled();
    rt.stopSession('conv-b');
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
    await rt.startSession(makeStartInput({ conversationId: 'conv-idle' }));

    await clock.advanceBy(1_200);

    expect(rt.sessionsLiveHost().get(undefined)?.states.list.snapshot().data).toEqual({});
    await clock.advanceBy(500);
    expect(h.lastChild.kill).toHaveBeenCalledWith('SIGTERM');
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
    expect(rt.sessionsLiveHost().get(undefined)?.states.list.snapshot().data).toHaveProperty(
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
    expect(rt.sessionLiveModels('conv-mcp')?.states.mcpServers.snapshot().data).toEqual([
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
    expect(rt.sessionLiveModels('conv-load-mcp')?.states.mcpServers.snapshot().data).toEqual([
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
    rt.killSession('conv-kill');

    await vi.waitFor(() => expect(intents.snapshot()).toEqual([]));
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
    const updates: Array<{ delta: unknown }> = [];
    const unsubscribe = live.states.activeTurn.subscribe((update) => updates.push(update));

    const prompt = rt.sendPrompt('conv-live', { text: 'hello' });
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

    const patches = updates.flatMap((update) => update.delta as Array<{ path: unknown[] }>);
    expect(patches.length).toBeGreaterThan(0);
    expect(patches.every((patch) => patch.path.length > 0)).toBe(true);
    unsubscribe();
    resolvePrompt({ stopReason: 'end_turn' });
    await prompt;
  });

  it('publishes usage updates through live models', async () => {
    const { rt, client, sessionId } = await startHarness('conv-usage');
    const live = rt.sessionLiveModels('conv-usage');
    if (!live) throw new Error('expected live models');
    const updates: unknown[] = [];
    const unsubscribe = live.states.usage.subscribe((update) => updates.push(update));

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

    expect(live.states.usage.snapshot().data).toEqual({
      contextUsed: 42_000,
      contextSize: 200_000,
      cost: { amount: 0.25, currency: 'USD' },
    });
    expect(updates.length).toBeGreaterThan(0);
    unsubscribe();
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
    expect(resolveAttachment).toHaveBeenCalledWith({
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

    const history = rt.getHistory('conv-attachment');
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

    const history = rt.getHistory('conv-hidden-context');
    expect(isOk(history)).toBe(true);
    if (!isOk(history)) return;
    expect(history.data.turns[0].items[0]).toMatchObject({
      kind: 'message',
      text: 'Fix @[ENG-123](issue:linear:ENG-123)',
    });
    expect(JSON.stringify(history.data.turns[0].items[0])).not.toContain('Context body');
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

    expect(rt.sessionLiveModels('conv-terminal')?.states.terminals.snapshot().data).toMatchObject([
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
    expect(rt.sessionLiveModels('conv-terminal')?.states.terminals.snapshot().data).toMatchObject([
      { terminalId: created.terminalId, exitStatus: { exitCode: 0, signal: null } },
    ]);
    unsub();
  });

  it('removes sessions when the process closes', async () => {
    const { h, rt } = await startHarness('conv-close');

    h.lastChild.emitExit(42);

    await vi.waitFor(() => expect(rt.getSessionState('conv-close').lifecycle).toBe('closed'));
    expect(rt.sessionLiveModels('conv-close')).toBeNull();
    expect(rt.sessionsListLiveModel().states.list.snapshot().data).toEqual({});
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
    expect(rt.sessionLiveModels('conv-a')).toBeNull();
    expect(rt.sessionLiveModels('conv-b')).toBeNull();
    expect(rt.sessionsListLiveModel().states.list.snapshot().data).toEqual({});
  });
});

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
