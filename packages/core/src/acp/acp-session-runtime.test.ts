import type { PermissionOptionKind } from '@agentclientprotocol/sdk';
import { describe, expect, it, vi } from 'vitest';
import { AcpSessionRuntime } from './acp-session-runtime';
import { FakeAcpProcessHandle, makeAcpHarness, makeStartInput } from './acp-test-support';

// ---------------------------------------------------------------------------
// Pooling
// ---------------------------------------------------------------------------

describe('AcpSessionRuntime – pooling', () => {
  it('two conversations in the same workspace share one child process', async () => {
    const h = makeAcpHarness();
    const rt = new AcpSessionRuntime(h.deps);

    h.agent.newSession
      .mockResolvedValueOnce({ sessionId: 'session-a' })
      .mockResolvedValueOnce({ sessionId: 'session-b' });

    await rt.start(makeStartInput({ conversationId: 'conv-a', workspaceId: 'ws-1' }));
    await rt.start(makeStartInput({ conversationId: 'conv-b', workspaceId: 'ws-1' }));

    expect(h.children).toHaveLength(1);
    expect(h.agent.newSession).toHaveBeenCalledTimes(2);
  });

  it('a third conversation in a different workspace spawns a second child', async () => {
    const h = makeAcpHarness();
    const rt = new AcpSessionRuntime(h.deps);

    h.agent.newSession.mockResolvedValue({ sessionId: 'session-x' });

    await rt.start(makeStartInput({ conversationId: 'conv-a', workspaceId: 'ws-1', cwd: '/ws1' }));
    await rt.start(makeStartInput({ conversationId: 'conv-c', workspaceId: 'ws-2', cwd: '/ws2' }));

    expect(h.children).toHaveLength(2);
  });

  it('stop on one of two pooled conversations keeps the child alive', async () => {
    const h = makeAcpHarness();
    const rt = new AcpSessionRuntime(h.deps);

    h.agent.newSession
      .mockResolvedValueOnce({ sessionId: 'session-a' })
      .mockResolvedValueOnce({ sessionId: 'session-b' });

    await rt.start(makeStartInput({ conversationId: 'conv-a', workspaceId: 'ws-1' }));
    await rt.start(makeStartInput({ conversationId: 'conv-b', workspaceId: 'ws-1' }));

    rt.stop('conv-a');

    expect(h.lastChild.kill).not.toHaveBeenCalled();
    expect(rt.isRunning('conv-b')).toBe(true);
  });

  it('stop on the last conversation kills the child', async () => {
    const h = makeAcpHarness();
    const rt = new AcpSessionRuntime(h.deps);

    h.agent.newSession
      .mockResolvedValueOnce({ sessionId: 'session-a' })
      .mockResolvedValueOnce({ sessionId: 'session-b' });

    await rt.start(makeStartInput({ conversationId: 'conv-a', workspaceId: 'ws-1' }));
    await rt.start(makeStartInput({ conversationId: 'conv-b', workspaceId: 'ws-1' }));

    rt.stop('conv-a');
    rt.stop('conv-b');

    expect(h.lastChild.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('child exit fans out closed events to all pooled conversations', async () => {
    const h = makeAcpHarness();
    const rt = new AcpSessionRuntime(h.deps);

    h.agent.newSession
      .mockResolvedValueOnce({ sessionId: 'session-a' })
      .mockResolvedValueOnce({ sessionId: 'session-b' });

    await rt.start(makeStartInput({ conversationId: 'conv-a', workspaceId: 'ws-1' }));
    await rt.start(makeStartInput({ conversationId: 'conv-b', workspaceId: 'ws-1' }));

    h.recording.clear();
    h.lastChild.emitExit(1);

    expect(h.recording.closed.map((c) => c.conversationId).sort()).toEqual(['conv-a', 'conv-b']);
    expect(rt.isRunning('conv-a')).toBe(false);
    expect(rt.isRunning('conv-b')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

describe('AcpSessionRuntime – routing', () => {
  it('sessionUpdate routes to the correct conversationId and emits turnId + seq', async () => {
    const h = makeAcpHarness();
    const rt = new AcpSessionRuntime(h.deps);

    h.agent.newSession
      .mockResolvedValueOnce({ sessionId: 'session-a' })
      .mockResolvedValueOnce({ sessionId: 'session-b' });

    await rt.start(makeStartInput({ conversationId: 'conv-a', workspaceId: 'ws-1' }));
    await rt.start(makeStartInput({ conversationId: 'conv-b', workspaceId: 'ws-1' }));

    h.recording.clear();

    await h.client().sessionUpdate({
      sessionId: 'session-b',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello' } },
    });

    expect(h.recording.updates).toHaveLength(1);
    expect(h.recording.updates[0].conversationId).toBe('conv-b');
    expect(typeof h.recording.updates[0].turnId).toBe('string');
    expect(typeof h.recording.updates[0].seq).toBe('number');
  });

  it('reconnecting with a sessionId calls loadSession and emits a replay turn', async () => {
    const h = makeAcpHarness();
    const rt = new AcpSessionRuntime(h.deps);

    await rt.start(
      makeStartInput({ conversationId: 'conv-replay', sessionId: 'existing-session-42' })
    );

    expect(h.agent.loadSession).toHaveBeenCalledWith({
      sessionId: 'existing-session-42',
      cwd: '/tmp/workspace',
      mcpServers: [],
    });
    expect(h.agent.newSession).not.toHaveBeenCalled();

    const lifecycles = h.recording.states.map((e) => e.lifecycle);
    expect(lifecycles).toContain('replaying');
    expect(lifecycles).toContain('ready');

    expect(h.recording.turns).toHaveLength(1);
    expect(h.recording.turns[0]).toMatchObject({
      conversationId: 'conv-replay',
      turn: expect.objectContaining({ source: 'replay', status: 'complete' }),
    });
  });

  it('falls back to newSession when loadSession throws; replay turn committed as complete', async () => {
    const h = makeAcpHarness();
    const rt = new AcpSessionRuntime(h.deps);

    h.agent.loadSession = vi.fn().mockRejectedValue(new Error('load failed'));
    h.agent.newSession = vi.fn().mockResolvedValue({ sessionId: 'fallback-session' });

    await rt.start(makeStartInput({ conversationId: 'conv-fallback', sessionId: 'bad-session' }));

    expect(h.agent.loadSession).toHaveBeenCalled();
    expect(h.agent.newSession).toHaveBeenCalled();
    expect(rt.isRunning('conv-fallback')).toBe(true);

    expect(h.recording.turns).toHaveLength(1);
    expect(h.recording.turns[0].turn).toMatchObject({ source: 'replay', status: 'complete' });
  });

  it('loadSession replay: agent-assigned session ID is dynamically registered and routed', async () => {
    const h = makeAcpHarness();
    const rt = new AcpSessionRuntime(h.deps);

    h.agent.loadSession = vi.fn().mockImplementation(async () => {
      await h.client().sessionUpdate({
        sessionId: 'agent-assigned-session-99',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } },
      });
      return {};
    });
    h.agent.newSession = vi.fn();

    await rt.start(
      makeStartInput({ conversationId: 'conv-dynamic', sessionId: 'stored-session-id' })
    );

    expect(h.recording.updates).toHaveLength(1);
    expect(h.recording.updates[0].conversationId).toBe('conv-dynamic');

    expect(h.agent.newSession).not.toHaveBeenCalled();
    expect(h.deps.persistSessionId).toHaveBeenCalledWith(
      'conv-dynamic',
      'agent-assigned-session-99'
    );
    expect(rt.isRunning('conv-dynamic')).toBe(true);
  });

  it('sessionUpdate for unknown sessionId does not emit an update event', async () => {
    const h = makeAcpHarness();
    const rt = new AcpSessionRuntime(h.deps);

    h.agent.newSession = vi.fn().mockResolvedValue({ sessionId: 'session-a' });
    await rt.start(makeStartInput({ conversationId: 'conv-a' }));

    h.recording.clear();

    await h.client().sessionUpdate({
      sessionId: 'unknown-session-xyz',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ghost' } },
    });

    expect(h.recording.updates).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Turn model
// ---------------------------------------------------------------------------

describe('AcpSessionRuntime – turn model', () => {
  it('prompt() opens a live turn, commits it as complete on end_turn stopReason', async () => {
    const h = makeAcpHarness();
    const rt = new AcpSessionRuntime(h.deps);

    h.agent.newSession = vi.fn().mockResolvedValue({ sessionId: 'session-1' });
    await rt.start(makeStartInput({ conversationId: 'conv-1' }));

    h.recording.clear();
    h.agent.prompt = vi.fn().mockResolvedValue({ stopReason: 'end_turn' });

    await rt.prompt('conv-1', 'hello');

    const lifecycles = h.recording.states.map((e) => e.lifecycle);
    expect(lifecycles).toContain('working');
    expect(lifecycles).toContain('ready');

    expect(h.recording.turns).toHaveLength(1);
    expect(h.recording.turns[0]).toMatchObject({
      conversationId: 'conv-1',
      turn: expect.objectContaining({ source: 'live', status: 'complete' }),
    });
  });

  it('prompt() commits turn as cancelled when stopReason is cancelled', async () => {
    const h = makeAcpHarness();
    const rt = new AcpSessionRuntime(h.deps);

    h.agent.newSession = vi.fn().mockResolvedValue({ sessionId: 'session-1' });
    await rt.start(makeStartInput({ conversationId: 'conv-1' }));

    h.recording.clear();
    h.agent.prompt = vi.fn().mockResolvedValue({ stopReason: 'cancelled' });

    await rt.prompt('conv-1', 'hi');

    expect(h.recording.turns).toHaveLength(1);
    expect(h.recording.turns[0].turn.status).toBe('cancelled');
  });

  it('prompt() commits turn as error when prompt() rejects', async () => {
    const h = makeAcpHarness();
    const rt = new AcpSessionRuntime(h.deps);

    h.agent.newSession = vi.fn().mockResolvedValue({ sessionId: 'session-1' });
    await rt.start(makeStartInput({ conversationId: 'conv-1' }));

    h.recording.clear();
    h.agent.prompt = vi.fn().mockRejectedValue(new Error('boom'));

    await rt.prompt('conv-1', 'fail');

    expect(h.recording.turns).toHaveLength(1);
    expect(h.recording.turns[0].turn.status).toBe('error');
  });

  it('getChatHistory returns only committed turns and correct complete flag', async () => {
    const h = makeAcpHarness();
    const rt = new AcpSessionRuntime(h.deps);

    h.agent.newSession = vi.fn().mockResolvedValue({ sessionId: 'session-hist' });

    expect(rt.getChatHistory('no-such-conv')).toEqual({ turns: [], complete: true });

    await rt.start(makeStartInput({ conversationId: 'conv-hist' }));

    let history = rt.getChatHistory('conv-hist');
    expect(history.turns).toHaveLength(0);
    expect(history.complete).toBe(true);

    h.agent.prompt = vi.fn().mockResolvedValue({ stopReason: 'end_turn' });
    await rt.prompt('conv-hist', 'hello');

    history = rt.getChatHistory('conv-hist');
    expect(history.turns).toHaveLength(1);
    expect(history.turns[0].status).toBe('complete');
    expect(history.complete).toBe(true);
  });

  it('getSessionState returns active turn mid-prompt', async () => {
    const h = makeAcpHarness();
    const rt = new AcpSessionRuntime(h.deps);

    h.agent.newSession = vi.fn().mockResolvedValue({ sessionId: 'session-state' });
    await rt.start(makeStartInput({ conversationId: 'conv-state' }));

    let resolvePrompt!: (val: { stopReason: string }) => void;
    h.agent.prompt = vi.fn().mockReturnValue(
      new Promise((res) => {
        resolvePrompt = res;
      })
    );

    const promptPromise = rt.prompt('conv-state', 'hi');

    const stateMidFlight = rt.getSessionState('conv-state');
    expect(stateMidFlight.lifecycle).toBe('working');
    expect(stateMidFlight.activeTurn).not.toBeNull();
    expect(stateMidFlight.activeTurn?.status).toBe('active');

    resolvePrompt({ stopReason: 'end_turn' });
    await promptPromise;

    const stateAfter = rt.getSessionState('conv-state');
    expect(stateAfter.lifecycle).toBe('ready');
    expect(stateAfter.activeTurn).toBeNull();
  });

  it('sessionUpdate attributes to active turn with incrementing seq and emits turnId', async () => {
    const h = makeAcpHarness();
    const rt = new AcpSessionRuntime(h.deps);

    h.agent.newSession = vi.fn().mockResolvedValue({ sessionId: 'session-buf' });
    await rt.start(makeStartInput({ conversationId: 'conv-buf' }));

    h.recording.clear();

    await h.client().sessionUpdate({
      sessionId: 'session-buf',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'a' } },
    });
    await h.client().sessionUpdate({
      sessionId: 'session-buf',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'b' } },
    });

    expect(h.recording.updates).toHaveLength(2);
    expect(h.recording.updates[0].seq).toBe(0);
    expect(h.recording.updates[1].seq).toBe(1);
    expect(h.recording.updates[0].turnId).toBe(h.recording.updates[1].turnId);

    const state = rt.getSessionState('conv-buf');
    expect(state.activeTurn?.updates).toHaveLength(2);
    expect(state.activeTurn?.updates[0].seq).toBe(0);
    expect(state.activeTurn?.updates[1].seq).toBe(1);
  });

  it('getChatHistory returns empty complete result for unknown conversation', () => {
    const h = makeAcpHarness();
    const rt = new AcpSessionRuntime(h.deps);
    expect(rt.getChatHistory('no-such-conversation')).toEqual({ turns: [], complete: true });
  });
});

// ---------------------------------------------------------------------------
// Permission requests
// ---------------------------------------------------------------------------

describe('AcpSessionRuntime – permission requests', () => {
  function makePermissionParams(sessionId: string, toolCallId = 'tool-1') {
    return {
      sessionId,
      toolCall: { toolCallId, title: 'Read a File', kind: 'read' as const },
      options: [
        { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' as PermissionOptionKind },
        {
          optionId: 'allow-always',
          name: 'Allow always',
          kind: 'allow_always' as PermissionOptionKind,
        },
        {
          optionId: 'reject-once',
          name: 'Reject once',
          kind: 'reject_once' as PermissionOptionKind,
        },
      ],
    };
  }

  it('requestPermission emits the request event and returns a pending promise', async () => {
    const h = makeAcpHarness();
    const rt = new AcpSessionRuntime(h.deps);

    h.agent.newSession = vi.fn().mockResolvedValue({ sessionId: 'session-perm' });
    h.agent.prompt = vi.fn().mockReturnValue(new Promise(() => {}));
    await rt.start(makeStartInput({ conversationId: 'conv-perm' }));

    let settled = false;
    const permPromise = h
      .client()
      .requestPermission(makePermissionParams('session-perm'))
      .then(() => {
        settled = true;
      });

    await Promise.resolve();
    expect(settled).toBe(false);

    expect(h.recording.permissionRequests).toHaveLength(1);
    expect(h.recording.permissionRequests[0].conversationId).toBe('conv-perm');
    expect(h.recording.permissionRequests[0].title).toBe('Read a File');
    expect(h.recording.permissionRequests[0].toolKind).toBe('read');
    expect(typeof h.recording.permissionRequests[0].requestId).toBe('string');

    const state = rt.getSessionState('conv-perm');
    expect(state.pendingPermissions).toHaveLength(1);
    expect(state.pendingPermissions[0].title).toBe('Read a File');

    rt.resolvePermission('conv-perm', h.recording.permissionRequests[0].requestId, 'allow-once');
    await permPromise;
  });

  it('resolvePermission fulfils the promise with the chosen optionId', async () => {
    const h = makeAcpHarness();
    const rt = new AcpSessionRuntime(h.deps);

    h.agent.newSession = vi.fn().mockResolvedValue({ sessionId: 'session-perm' });
    h.agent.prompt = vi.fn().mockReturnValue(new Promise(() => {}));
    await rt.start(makeStartInput({ conversationId: 'conv-resolve' }));

    const resultPromise: Promise<{ outcome: { outcome: string; optionId?: string } }> = h
      .client()
      .requestPermission(makePermissionParams('session-perm'));

    const requestId = h.recording.permissionRequests[0].requestId;

    rt.resolvePermission('conv-resolve', requestId, 'allow-once');

    const result = await resultPromise;
    expect(result.outcome).toEqual({ outcome: 'selected', optionId: 'allow-once' });

    expect(h.recording.permissionResolved).toHaveLength(1);
    expect(h.recording.permissionResolved[0]).toMatchObject({
      conversationId: 'conv-resolve',
      requestId,
    });

    expect(rt.getSessionState('conv-resolve').pendingPermissions).toHaveLength(0);
  });

  it('resolvePermission with null sends outcome:cancelled', async () => {
    const h = makeAcpHarness();
    const rt = new AcpSessionRuntime(h.deps);

    h.agent.newSession = vi.fn().mockResolvedValue({ sessionId: 'session-perm' });
    h.agent.prompt = vi.fn().mockReturnValue(new Promise(() => {}));
    await rt.start(makeStartInput({ conversationId: 'conv-cancel' }));

    const resultPromise: Promise<{ outcome: { outcome: string } }> = h
      .client()
      .requestPermission(makePermissionParams('session-perm'));

    const requestId = h.recording.permissionRequests[0].requestId;

    rt.resolvePermission('conv-cancel', requestId, null);
    const result = await resultPromise;
    expect(result.outcome).toEqual({ outcome: 'cancelled' });
  });

  it('resolvePermission is idempotent: second call is a no-op', async () => {
    const h = makeAcpHarness();
    const rt = new AcpSessionRuntime(h.deps);

    h.agent.newSession = vi.fn().mockResolvedValue({ sessionId: 'session-perm' });
    h.agent.prompt = vi.fn().mockReturnValue(new Promise(() => {}));
    await rt.start(makeStartInput({ conversationId: 'conv-idem' }));

    const resultPromise = h.client().requestPermission(makePermissionParams('session-perm'));
    const requestId = h.recording.permissionRequests[0].requestId;

    rt.resolvePermission('conv-idem', requestId, 'allow-once');
    await resultPromise;

    h.recording.clear();
    rt.resolvePermission('conv-idem', requestId, 'allow-once');
    expect(h.recording.permissionResolved).toHaveLength(0);
  });

  it('stop() drains pending permissions with cancelled outcome', async () => {
    const h = makeAcpHarness();
    const rt = new AcpSessionRuntime(h.deps);

    h.agent.newSession = vi.fn().mockResolvedValue({ sessionId: 'session-perm' });
    h.agent.prompt = vi.fn().mockReturnValue(new Promise(() => {}));
    await rt.start(makeStartInput({ conversationId: 'conv-stop' }));

    const resultPromise: Promise<{ outcome: { outcome: string } }> = h
      .client()
      .requestPermission(makePermissionParams('session-perm'));

    const requestId = h.recording.permissionRequests[0].requestId;

    rt.stop('conv-stop');

    const result = await resultPromise;
    expect(result.outcome).toEqual({ outcome: 'cancelled' });

    expect(h.recording.permissionResolved.some((r) => r.requestId === requestId)).toBe(true);
  });

  it('getSessionState includes pendingPermissions for reload rehydration', async () => {
    const h = makeAcpHarness();
    const rt = new AcpSessionRuntime(h.deps);

    h.agent.newSession = vi.fn().mockResolvedValue({ sessionId: 'session-perm' });
    h.agent.prompt = vi.fn().mockReturnValue(new Promise(() => {}));
    await rt.start(makeStartInput({ conversationId: 'conv-rehydrate' }));

    const p1 = h.client().requestPermission(makePermissionParams('session-perm', 'tool-1'));
    const p2 = h.client().requestPermission(makePermissionParams('session-perm', 'tool-2'));

    expect(rt.getSessionState('conv-rehydrate').pendingPermissions).toHaveLength(2);

    rt.resolvePermission(
      'conv-rehydrate',
      h.recording.permissionRequests[0].requestId,
      'allow-once'
    );
    rt.resolvePermission(
      'conv-rehydrate',
      h.recording.permissionRequests[1].requestId,
      'allow-once'
    );
    await Promise.all([p1, p2]);
  });

  it('child crash drains pending permissions with cancelled outcome', async () => {
    const h = makeAcpHarness();
    const rt = new AcpSessionRuntime(h.deps);

    h.agent.newSession = vi.fn().mockResolvedValue({ sessionId: 'session-crash' });
    h.agent.prompt = vi.fn().mockReturnValue(new Promise(() => {}));
    await rt.start(makeStartInput({ conversationId: 'conv-crash' }));

    const resultPromise: Promise<{ outcome: { outcome: string } }> = h
      .client()
      .requestPermission(makePermissionParams('session-crash'));

    expect(rt.getSessionState('conv-crash').pendingPermissions).toHaveLength(1);

    h.lastChild.emitExit(1);

    const result = await resultPromise;
    expect(result.outcome).toEqual({ outcome: 'cancelled' });
    expect(rt.isRunning('conv-crash')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Concurrency guard
// ---------------------------------------------------------------------------

describe('AcpSessionRuntime – concurrency guard', () => {
  it('concurrent start() calls for the same conversation result in only one newSession', async () => {
    const h = makeAcpHarness();
    const rt = new AcpSessionRuntime(h.deps);

    h.agent.newSession = vi.fn().mockResolvedValue({ sessionId: 'session-once' });

    const [, second] = await Promise.all([
      rt.start(makeStartInput({ conversationId: 'conv-concurrent' })),
      rt.start(makeStartInput({ conversationId: 'conv-concurrent' })),
    ]);

    expect(h.agent.newSession).toHaveBeenCalledTimes(1);
    expect(second).toBeUndefined();
    expect(rt.isRunning('conv-concurrent')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// File handlers
// ---------------------------------------------------------------------------

describe('AcpSessionRuntime – file handlers', () => {
  it('readTextFile delegates to host.fs.readFile', async () => {
    const h = makeAcpHarness();
    const rt = new AcpSessionRuntime(h.deps);

    h.agent.newSession = vi.fn().mockResolvedValue({ sessionId: 'session-fs' });
    (h.deps.host.fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('file content');

    await rt.start(makeStartInput({ conversationId: 'conv-fs' }));

    const client = h.client();
    const result = await client.readTextFile?.({ sessionId: 'session-fs', path: '/some/file.txt' });
    expect(result?.content).toBe('file content');
    expect(h.deps.host.fs.readFile).toHaveBeenCalledWith('/some/file.txt', 'utf8');
  });

  it('writeTextFile delegates to host.fs mkdir + writeFile', async () => {
    const h = makeAcpHarness();
    const rt = new AcpSessionRuntime(h.deps);

    h.agent.newSession = vi.fn().mockResolvedValue({ sessionId: 'session-fs' });
    await rt.start(makeStartInput({ conversationId: 'conv-fs' }));

    const client = h.client();
    await client.writeTextFile?.({
      sessionId: 'session-fs',
      path: '/dir/file.txt',
      content: 'hello',
    });
    expect(h.deps.host.fs.mkdir).toHaveBeenCalledWith('/dir', { recursive: true });
    expect(h.deps.host.fs.writeFile).toHaveBeenCalledWith('/dir/file.txt', 'hello', 'utf8');
  });
});

// ---------------------------------------------------------------------------
// Process handle: FakeAcpProcessHandle sanity
// ---------------------------------------------------------------------------

describe('FakeAcpProcessHandle', () => {
  it('onExit callback fires on emitExit', () => {
    const handle = new FakeAcpProcessHandle();
    const cb = vi.fn();
    handle.onExit(cb);
    handle.emitExit(42);
    expect(cb).toHaveBeenCalledWith(42);
    expect(handle.exitCode).toBe(42);
  });

  it('onError callback fires on emitError', () => {
    const handle = new FakeAcpProcessHandle();
    const cb = vi.fn();
    handle.onError(cb);
    const err = new Error('oops');
    handle.emitError(err);
    expect(cb).toHaveBeenCalledWith(err);
  });
});
