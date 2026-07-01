import type { PermissionOptionKind, SessionUpdate } from '@agentclientprotocol/sdk';
import { describe, expect, it, vi } from 'vitest';
import { AcpSessionRuntime } from './acp-session-runtime';
import {
  FakeAcpProcessHandle,
  FakeAcpTerminalProcess,
  makeAcpHarness,
  makeStartInput,
} from './acp-test-support';
import type { AgentUpdate } from './agent-update';

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
    // Keep prompt pending so we can inject sessionUpdate while working
    h.agent.prompt = vi.fn().mockReturnValue(new Promise(() => {}));

    await rt.start(makeStartInput({ conversationId: 'conv-a', workspaceId: 'ws-1' }));
    await rt.start(makeStartInput({ conversationId: 'conv-b', workspaceId: 'ws-1' }));

    // Open a live turn on conv-b by sending a prompt
    void rt.prompt('conv-b', 'hi');
    await Promise.resolve();

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

    const lifecycles = h.recording.snapshots.map((e) => e.snapshot.lifecycle);
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

    const lifecycles = h.recording.snapshots.map((e) => e.snapshot.lifecycle);
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
    // Keep prompt pending so we can inject sessionUpdate while working
    h.agent.prompt = vi.fn().mockReturnValue(new Promise(() => {}));
    await rt.start(makeStartInput({ conversationId: 'conv-buf' }));

    // Open a live turn
    void rt.prompt('conv-buf', 'hello');
    await Promise.resolve();

    // After PromptStarted, the user message was the first update (seq 0).
    // Next agent updates start at seq 1.
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
    expect(h.recording.updates[0].turnId).toBe(h.recording.updates[1].turnId);

    const state = rt.getSessionState('conv-buf');
    // activeTurn has: user msg (seq 0), agent 'a', agent 'b'
    expect(state.activeTurn?.updates).toHaveLength(3);
    expect(state.activeTurn?.updates[1].seq).toBeLessThan(state.activeTurn?.updates[2].seq!);
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
    const permPromise = Promise.resolve(
      h.client().requestPermission(makePermissionParams('session-perm'))
    ).then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    const state = rt.getSessionState('conv-perm');
    expect(state.pendingPermissions).toHaveLength(1);
    expect(state.pendingPermissions[0].conversationId).toBe('conv-perm');
    expect(state.pendingPermissions[0].title).toBe('Read a File');
    expect(state.pendingPermissions[0].toolKind).toBe('read');
    expect(typeof state.pendingPermissions[0].requestId).toBe('string');

    rt.resolvePermission('conv-perm', state.pendingPermissions[0].requestId, 'allow-once');
    await permPromise;
  });

  it('resolvePermission fulfils the promise with the chosen optionId', async () => {
    const h = makeAcpHarness();
    const rt = new AcpSessionRuntime(h.deps);

    h.agent.newSession = vi.fn().mockResolvedValue({ sessionId: 'session-perm' });
    h.agent.prompt = vi.fn().mockReturnValue(new Promise(() => {}));
    await rt.start(makeStartInput({ conversationId: 'conv-resolve' }));

    const resultPromise = Promise.resolve(
      h.client().requestPermission(makePermissionParams('session-perm'))
    );

    await Promise.resolve();
    const requestId = rt.getSessionState('conv-resolve').pendingPermissions[0].requestId;

    rt.resolvePermission('conv-resolve', requestId, 'allow-once');

    const result = await resultPromise;
    expect(result.outcome).toEqual({ outcome: 'selected', optionId: 'allow-once' });
    expect(rt.getSessionState('conv-resolve').pendingPermissions).toHaveLength(0);
  });

  it('resolvePermission with null sends outcome:cancelled', async () => {
    const h = makeAcpHarness();
    const rt = new AcpSessionRuntime(h.deps);

    h.agent.newSession = vi.fn().mockResolvedValue({ sessionId: 'session-perm' });
    h.agent.prompt = vi.fn().mockReturnValue(new Promise(() => {}));
    await rt.start(makeStartInput({ conversationId: 'conv-cancel' }));

    const resultPromise = Promise.resolve(
      h.client().requestPermission(makePermissionParams('session-perm'))
    );

    await Promise.resolve();
    const requestId = rt.getSessionState('conv-cancel').pendingPermissions[0].requestId;

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

    await Promise.resolve();
    const requestId = rt.getSessionState('conv-idem').pendingPermissions[0].requestId;

    rt.resolvePermission('conv-idem', requestId, 'allow-once');
    await resultPromise;

    // Second call is a no-op — no snapshot emitted for an unknown requestId
    h.recording.clear();
    rt.resolvePermission('conv-idem', requestId, 'allow-once');
    expect(h.recording.snapshots).toHaveLength(0);
  });

  it('stop() drains pending permissions with cancelled outcome', async () => {
    const h = makeAcpHarness();
    const rt = new AcpSessionRuntime(h.deps);

    h.agent.newSession = vi.fn().mockResolvedValue({ sessionId: 'session-perm' });
    h.agent.prompt = vi.fn().mockReturnValue(new Promise(() => {}));
    await rt.start(makeStartInput({ conversationId: 'conv-stop' }));

    const resultPromise = Promise.resolve(
      h.client().requestPermission(makePermissionParams('session-perm'))
    );

    await Promise.resolve();
    const requestId = rt.getSessionState('conv-stop').pendingPermissions[0].requestId;
    expect(requestId).toBeDefined();

    rt.stop('conv-stop');

    const result = await resultPromise;
    expect(result.outcome).toEqual({ outcome: 'cancelled' });
  });

  it('getSessionState includes pendingPermissions for reload rehydration', async () => {
    const h = makeAcpHarness();
    const rt = new AcpSessionRuntime(h.deps);

    h.agent.newSession = vi.fn().mockResolvedValue({ sessionId: 'session-perm' });
    h.agent.prompt = vi.fn().mockReturnValue(new Promise(() => {}));
    await rt.start(makeStartInput({ conversationId: 'conv-rehydrate' }));

    const p1 = h.client().requestPermission(makePermissionParams('session-perm', 'tool-1'));
    const p2 = h.client().requestPermission(makePermissionParams('session-perm', 'tool-2'));

    await Promise.resolve();
    const pendingPerms = rt.getSessionState('conv-rehydrate').pendingPermissions;
    expect(pendingPerms).toHaveLength(2);

    rt.resolvePermission('conv-rehydrate', pendingPerms[0].requestId, 'allow-once');
    rt.resolvePermission('conv-rehydrate', pendingPerms[1].requestId, 'allow-once');
    await Promise.all([p1, p2]);
  });

  it('child crash drains pending permissions with cancelled outcome', async () => {
    const h = makeAcpHarness();
    const rt = new AcpSessionRuntime(h.deps);

    h.agent.newSession = vi.fn().mockResolvedValue({ sessionId: 'session-crash' });
    h.agent.prompt = vi.fn().mockReturnValue(new Promise(() => {}));
    await rt.start(makeStartInput({ conversationId: 'conv-crash' }));

    const resultPromise = Promise.resolve(
      h.client().requestPermission(makePermissionParams('session-crash'))
    );

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

    const [first, second] = await Promise.all([
      rt.start(makeStartInput({ conversationId: 'conv-concurrent' })),
      rt.start(makeStartInput({ conversationId: 'conv-concurrent' })),
    ]);

    expect(h.agent.newSession).toHaveBeenCalledTimes(1);
    // Both calls return a Result; the duplicate (second) is a no-op returning ok()
    expect(first).toBeDefined();
    expect(second).toBeDefined();
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

// ---------------------------------------------------------------------------
// Terminals
// ---------------------------------------------------------------------------

/** Small helper — start a conversation and return {rt, h, client, sessionId}. */
async function setupSession(sessionId = 'sess-t1') {
  const h = makeAcpHarness();
  const rt = new AcpSessionRuntime(h.deps);
  h.agent.newSession.mockResolvedValue({ sessionId });
  await rt.start(makeStartInput({ conversationId: 'conv-t1', workspaceId: 'ws-t' }));
  const client = h.client();
  return { h, rt, client, sessionId };
}

describe('AcpSessionRuntime – terminals', () => {
  it('advertises terminal capability when host has spawnTerminal', async () => {
    const { h } = await setupSession();
    expect(h.agent.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        clientCapabilities: expect.objectContaining({ terminal: true }),
      })
    );
  });

  it('does NOT advertise terminal capability when host lacks spawnTerminal', async () => {
    const h = makeAcpHarness();
    // Remove spawnTerminal from the host
    (h.fakeHost as { spawnTerminal?: unknown }).spawnTerminal = undefined;
    const rt = new AcpSessionRuntime(h.deps);
    h.agent.newSession.mockResolvedValue({ sessionId: 'sess-no-term' });
    await rt.start(makeStartInput({ conversationId: 'conv-no-term', workspaceId: 'ws-nt' }));
    expect(h.agent.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        clientCapabilities: expect.objectContaining({ terminal: false }),
      })
    );
  });

  it('createTerminal spawns a process and emits onTerminalCreated', async () => {
    const { h, client, sessionId } = await setupSession();
    const proc = new FakeAcpTerminalProcess();
    h.fakeHost.nextTerminal = proc;

    const resp = await client.createTerminal!({
      sessionId,
      command: 'echo',
      args: ['hello'],
      cwd: '/tmp',
      env: [{ name: 'FOO', value: 'bar' }],
    });

    expect(resp.terminalId).toBeTypeOf('string');
    expect(h.fakeHost.spawnTerminalFn).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'echo', args: ['hello'], cwd: '/tmp' })
    );
    expect(h.recording.terminalCreated).toHaveLength(1);
    expect(h.recording.terminalCreated[0]).toMatchObject({
      conversationId: 'conv-t1',
      terminalId: resp.terminalId,
      command: 'echo',
      args: ['hello'],
      cwd: '/tmp',
    });
  });

  it('stdout output is buffered and emitted via onTerminalOutput', async () => {
    const { h, client, sessionId } = await setupSession();
    const proc = new FakeAcpTerminalProcess();
    h.fakeHost.nextTerminal = proc;

    const { terminalId } = await client.createTerminal!({ sessionId, command: 'cat' });

    proc.pushOutput('hello ');
    proc.pushOutput('world');

    // Drain microtask queue so PassThrough events propagate
    await new Promise<void>((r) => setImmediate(r));

    expect(h.recording.terminalOutput.map((e) => e.chunk)).toEqual(['hello ', 'world']);
    expect(h.recording.terminalOutput.every((e) => e.terminalId === terminalId)).toBe(true);
    expect(h.recording.terminalOutput.every((e) => e.truncated === false)).toBe(true);
  });

  it('output is truncated when byteLimit is exceeded', async () => {
    const { h, client, sessionId } = await setupSession();
    const proc = new FakeAcpTerminalProcess();
    h.fakeHost.nextTerminal = proc;

    // 10-byte limit
    const { terminalId } = await client.createTerminal!({
      sessionId,
      command: 'flood',
      outputByteLimit: 10,
    });

    proc.pushOutput('12345');
    proc.pushOutput('67890');
    proc.pushOutput('ABCDE'); // exceeds limit — oldest bytes discarded
    await new Promise<void>((r) => setImmediate(r));

    // Snapshot output should be at most 10 bytes
    const snap = await client.terminalOutput!({ sessionId, terminalId });
    expect(snap.truncated).toBe(true);
    expect(Buffer.byteLength(snap.output, 'utf8')).toBeLessThanOrEqual(10);
  });

  it('terminalOutput returns snapshot before exit', async () => {
    const { h, client, sessionId } = await setupSession();
    const proc = new FakeAcpTerminalProcess();
    h.fakeHost.nextTerminal = proc;

    const { terminalId } = await client.createTerminal!({ sessionId, command: 'sleep' });
    proc.pushOutput('progress');
    await new Promise<void>((r) => setImmediate(r));

    const snap = await client.terminalOutput!({ sessionId, terminalId });
    expect(snap.output).toBe('progress');
    expect(snap.exitStatus).toBeUndefined();
  });

  it('waitForTerminalExit resolves once the process exits', async () => {
    const { h, client, sessionId } = await setupSession();
    const proc = new FakeAcpTerminalProcess();
    h.fakeHost.nextTerminal = proc;

    const { terminalId } = await client.createTerminal!({ sessionId, command: 'sleep' });

    const waitPromise = client.waitForTerminalExit!({ sessionId, terminalId });
    proc.triggerExit({ exitCode: 0, signal: null });
    await new Promise<void>((r) => setImmediate(r));

    const result = await waitPromise;
    expect(result).toMatchObject({ exitCode: 0 });

    expect(h.recording.terminalExit).toHaveLength(1);
    expect(h.recording.terminalExit[0]).toMatchObject({
      conversationId: 'conv-t1',
      terminalId,
      exitStatus: { exitCode: 0, signal: null },
    });
  });

  it('killTerminal sends SIGTERM to the process', async () => {
    const { h, client, sessionId } = await setupSession();
    const proc = new FakeAcpTerminalProcess();
    h.fakeHost.nextTerminal = proc;

    const { terminalId } = await client.createTerminal!({ sessionId, command: 'long' });
    await client.killTerminal!({ sessionId, terminalId });

    expect(proc.killFn).toHaveBeenCalledWith('SIGTERM');
  });

  it('releaseTerminal disposes the process and emits onTerminalReleased', async () => {
    const { h, client, sessionId, rt } = await setupSession();
    const proc = new FakeAcpTerminalProcess();
    h.fakeHost.nextTerminal = proc;

    const { terminalId } = await client.createTerminal!({ sessionId, command: 'tmp' });
    expect(rt.getTerminals('conv-t1')).toHaveLength(1);

    await client.releaseTerminal!({ sessionId, terminalId });

    expect(proc.killFn).toHaveBeenCalledWith('SIGTERM');
    expect(rt.getTerminals('conv-t1')).toHaveLength(0);
    expect(h.recording.terminalReleased).toHaveLength(1);
    expect(h.recording.terminalReleased[0]).toMatchObject({
      conversationId: 'conv-t1',
      terminalId,
    });
  });

  it('getTerminals returns snapshots for all live terminals', async () => {
    const { h, client, sessionId, rt } = await setupSession();

    const proc1 = new FakeAcpTerminalProcess();
    h.fakeHost.nextTerminal = proc1;
    const { terminalId: t1 } = await client.createTerminal!({ sessionId, command: 'cmd1' });
    proc1.pushOutput('out1');

    const proc2 = new FakeAcpTerminalProcess();
    h.fakeHost.nextTerminal = proc2;
    const { terminalId: t2 } = await client.createTerminal!({ sessionId, command: 'cmd2' });
    proc2.pushOutput('out2');

    await new Promise<void>((r) => setImmediate(r));

    const snaps = rt.getTerminals('conv-t1');
    expect(snaps).toHaveLength(2);
    expect(snaps.find((s) => s.terminalId === t1)?.output).toBe('out1');
    expect(snaps.find((s) => s.terminalId === t2)?.output).toBe('out2');
  });

  it('stop() disposes all terminals and emits onTerminalReleased for each', async () => {
    const { h, client, sessionId, rt } = await setupSession();

    const proc1 = new FakeAcpTerminalProcess();
    h.fakeHost.nextTerminal = proc1;
    await client.createTerminal!({ sessionId, command: 't1' });

    const proc2 = new FakeAcpTerminalProcess();
    h.fakeHost.nextTerminal = proc2;
    await client.createTerminal!({ sessionId, command: 't2' });

    rt.stop('conv-t1');

    expect(proc1.killFn).toHaveBeenCalled();
    expect(proc2.killFn).toHaveBeenCalled();
    expect(h.recording.terminalReleased).toHaveLength(2);
  });

  it('handleProcessClosed disposes all terminals in all process conversations', async () => {
    const h = makeAcpHarness();
    const rt = new AcpSessionRuntime(h.deps);
    h.agent.newSession
      .mockResolvedValueOnce({ sessionId: 'sess-a' })
      .mockResolvedValueOnce({ sessionId: 'sess-b' });

    await rt.start(makeStartInput({ conversationId: 'conv-a', workspaceId: 'ws-shared' }));
    await rt.start(makeStartInput({ conversationId: 'conv-b', workspaceId: 'ws-shared' }));

    const clientA = h.client(); // same client handler since same pool

    const procA = new FakeAcpTerminalProcess();
    h.fakeHost.nextTerminal = procA;
    await clientA.createTerminal!({ sessionId: 'sess-a', command: 'ta' });

    const procB = new FakeAcpTerminalProcess();
    h.fakeHost.nextTerminal = procB;
    await clientA.createTerminal!({ sessionId: 'sess-b', command: 'tb' });

    // Simulate child process death
    h.lastChild.emitExit(1);

    expect(procA.killFn).toHaveBeenCalled();
    expect(procB.killFn).toHaveBeenCalled();
    const released = h.recording.terminalReleased.map((e) => e.terminalId);
    expect(released).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Enrich / normalize
// ---------------------------------------------------------------------------

describe('AcpSessionRuntime – enrich', () => {
  const rawTextUpdate = (): SessionUpdate => ({
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: 'hello' },
  });

  const expectedAgentMessage: AgentUpdate = {
    kind: 'message',
    role: 'assistant',
    messageId: null,
    text: 'hello',
  };

  it('baseline toAgentUpdate runs even without a provider enrich', async () => {
    const emittedUpdates: AgentUpdate[] = [];
    const h = makeAcpHarness({
      listener: {
        onSnapshot: () => {},
        onSessionUpdate: (e) => emittedUpdates.push(e.update),
        onTurnCommitted: () => {},
        onClosed: () => {},
        onAgentEvent: () => {},
        onTerminalCreated: () => {},
        onTerminalOutput: () => {},
        onTerminalExit: () => {},
        onTerminalReleased: () => {},
      },
    });

    const rt = new AcpSessionRuntime(h.deps);
    h.agent.newSession.mockResolvedValue({ sessionId: 'sess-1' });
    h.agent.prompt = vi.fn().mockReturnValue(new Promise(() => {}));
    await rt.start(makeStartInput({ conversationId: 'conv-1' }));

    // Open a live turn (user message is emitted as first update)
    void rt.prompt('conv-1', 'hi');
    await Promise.resolve();
    // Clear to focus on the subsequent agent update
    emittedUpdates.length = 0;

    await h.client().sessionUpdate({ sessionId: 'sess-1', update: rawTextUpdate() });

    expect(emittedUpdates).toHaveLength(1);
    expect(emittedUpdates[0]).toStrictEqual(expectedAgentMessage);
  });

  it('stores the normalized AgentUpdate in the turn', async () => {
    const h = makeAcpHarness();

    const rt = new AcpSessionRuntime(h.deps);
    h.agent.newSession.mockResolvedValue({ sessionId: 'sess-1' });
    h.agent.prompt = vi.fn().mockReturnValue(new Promise(() => {}));
    await rt.start(makeStartInput({ conversationId: 'conv-1' }));

    // Open a live turn
    void rt.prompt('conv-1', 'hi');
    await Promise.resolve();

    await h.client().sessionUpdate({ sessionId: 'sess-1', update: rawTextUpdate() });

    // getSessionState returns a structuredClone, so use deep equality.
    // updates[0] is the user message; updates[1] is the first agent update.
    const state = rt.getSessionState('conv-1');
    const storedUpdate = state.activeTurn?.updates[1]?.update;
    expect(storedUpdate).toStrictEqual(expectedAgentMessage);
  });

  it('provider enrich is called with the baseline AgentUpdate and the raw SessionUpdate', async () => {
    const h = makeAcpHarness();
    const enrichFn = vi.fn().mockImplementation((u: AgentUpdate) => u);
    (h.deps as { resolveAcp: unknown }).resolveAcp = () => ({
      behavior: {
        buildSpawn: () => ({ command: '/fake/node', args: ['agent.js'], env: {} }),
        connect: h.agent.behavior.connect,
        enrich: enrichFn,
      },
    });

    const rt = new AcpSessionRuntime(h.deps);
    h.agent.newSession.mockResolvedValue({ sessionId: 'sess-1' });
    h.agent.prompt = vi.fn().mockReturnValue(new Promise(() => {}));
    await rt.start(makeStartInput({ conversationId: 'conv-1' }));

    // Open a live turn
    void rt.prompt('conv-1', 'hi');
    await Promise.resolve();

    const raw = rawTextUpdate();
    await h.client().sessionUpdate({ sessionId: 'sess-1', update: raw });

    expect(enrichFn).toHaveBeenCalledTimes(1);
    // First arg is the decoded AgentUpdate, second is the original raw SessionUpdate.
    expect(enrichFn).toHaveBeenCalledWith(expectedAgentMessage, raw);
  });

  it('provider enrich can override parentToolCallId', async () => {
    const enriched: AgentUpdate = {
      kind: 'tool_call',
      toolCallId: 'tc-1',
      title: 'Bash',
      toolKind: 'execute',
      status: 'in_progress',
      parentToolCallId: 'parent-42',
      diffs: [],
    };

    const emittedUpdates: AgentUpdate[] = [];
    const h = makeAcpHarness({
      listener: {
        onSnapshot: () => {},
        onSessionUpdate: (e) => emittedUpdates.push(e.update),
        onTurnCommitted: () => {},
        onClosed: () => {},
        onAgentEvent: () => {},
        onTerminalCreated: () => {},
        onTerminalOutput: () => {},
        onTerminalExit: () => {},
        onTerminalReleased: () => {},
      },
    });
    const enrichFn = vi.fn().mockReturnValue(enriched);
    (h.deps as { resolveAcp: unknown }).resolveAcp = () => ({
      behavior: {
        buildSpawn: () => ({ command: '/fake/node', args: ['agent.js'], env: {} }),
        connect: h.agent.behavior.connect,
        enrich: enrichFn,
      },
    });

    const rt = new AcpSessionRuntime(h.deps);
    h.agent.newSession.mockResolvedValue({ sessionId: 'sess-1' });
    h.agent.prompt = vi.fn().mockReturnValue(new Promise(() => {}));
    await rt.start(makeStartInput({ conversationId: 'conv-1' }));

    // Open a live turn (user message captured at emittedUpdates[0])
    void rt.prompt('conv-1', 'hi');
    await Promise.resolve();
    // Clear to focus on the agent update only
    emittedUpdates.length = 0;

    const raw: SessionUpdate = {
      sessionUpdate: 'tool_call',
      toolCallId: 'tc-1',
      title: 'Bash',
      kind: 'execute',
      status: 'in_progress',
    };
    await h.client().sessionUpdate({ sessionId: 'sess-1', update: raw });

    expect(emittedUpdates).toHaveLength(1);
    expect(emittedUpdates[0]).toBe(enriched);

    // activeTurn: updates[0]=user msg, updates[1]=enriched agent update
    const state = rt.getSessionState('conv-1');
    const stored = state.activeTurn?.updates[1]?.update as AgentUpdate & { kind: 'tool_call' };
    expect(stored?.parentToolCallId).toBe('parent-42');
  });
});

// ---------------------------------------------------------------------------
// SessionUsage routing
// ---------------------------------------------------------------------------

describe('AcpSessionRuntime – usage_update routing', () => {
  it('usage_update emits a snapshot with usage populated and no turn Updated event', async () => {
    const h = makeAcpHarness();
    const rt = new AcpSessionRuntime(h.deps);
    h.agent.newSession.mockResolvedValue({ sessionId: 'sess-1' });

    await rt.start(makeStartInput({ conversationId: 'conv-1' }));
    h.recording.clear();

    await h.client().sessionUpdate({
      sessionId: 'sess-1',
      update: { sessionUpdate: 'usage_update', size: 200000, used: 45000 },
    });

    // A snapshot must have been emitted with usage filled
    expect(h.recording.snapshots).toHaveLength(1);
    expect(h.recording.snapshots[0].snapshot.usage).toEqual({
      contextSize: 200000,
      contextUsed: 45000,
      cost: null,
    });

    // No turn update emitted — usage_update is a meta event, not a turn event
    expect(h.recording.updates).toHaveLength(0);
  });

  it('usage_update with cost propagates cost into the snapshot', async () => {
    const h = makeAcpHarness();
    const rt = new AcpSessionRuntime(h.deps);
    h.agent.newSession.mockResolvedValue({ sessionId: 'sess-1' });

    await rt.start(makeStartInput({ conversationId: 'conv-1' }));
    h.recording.clear();

    await h.client().sessionUpdate({
      sessionId: 'sess-1',
      update: {
        sessionUpdate: 'usage_update',
        size: 100000,
        used: 20000,
        cost: { amount: 0.25, currency: 'USD' },
      },
    });

    expect(h.recording.snapshots[0].snapshot.usage?.cost).toEqual({
      amount: 0.25,
      currency: 'USD',
    });
  });

  it('getSessionState returns usage after a usage_update', async () => {
    const h = makeAcpHarness();
    const rt = new AcpSessionRuntime(h.deps);
    h.agent.newSession.mockResolvedValue({ sessionId: 'sess-1' });

    await rt.start(makeStartInput({ conversationId: 'conv-1' }));

    await h.client().sessionUpdate({
      sessionId: 'sess-1',
      update: { sessionUpdate: 'usage_update', size: 50000, used: 10000 },
    });

    const state = rt.getSessionState('conv-1');
    expect(state.usage).toEqual({ contextSize: 50000, contextUsed: 10000, cost: null });
  });
});

// ---------------------------------------------------------------------------
// Model re-apply gating
// ---------------------------------------------------------------------------

describe('AcpSessionRuntime – model re-apply', () => {
  it('applies the creation-time model via setSessionConfigOption on a fresh newSession', async () => {
    const h = makeAcpHarness();
    const rt = new AcpSessionRuntime(h.deps);
    h.agent.newSession.mockResolvedValue({ sessionId: 'sess-1' });
    h.agent.setSessionConfigOption.mockResolvedValue({ configOptions: [] });

    await rt.start(makeStartInput({ conversationId: 'conv-1', model: 'claude-3-7-sonnet' }));

    expect(h.agent.setSessionConfigOption).toHaveBeenCalledWith(
      expect.objectContaining({ configId: 'model', value: 'claude-3-7-sonnet' })
    );
  });

  it('does NOT re-apply the model when resuming via loadSession', async () => {
    const h = makeAcpHarness();
    const rt = new AcpSessionRuntime(h.deps);
    h.agent.loadSession.mockResolvedValue({
      configOptions: [
        {
          id: 'model',
          type: 'select',
          name: 'Model',
          currentValue: 'claude-3-5-sonnet',
          options: [],
        },
      ],
    });

    await rt.start(
      makeStartInput({
        conversationId: 'conv-1',
        sessionId: 'existing-session',
        model: 'claude-3-7-sonnet',
      })
    );

    expect(h.agent.loadSession).toHaveBeenCalled();
    expect(h.agent.newSession).not.toHaveBeenCalled();
    expect(h.agent.setSessionConfigOption).not.toHaveBeenCalled();
  });

  it('re-applies the model when loadSession fails and falls back to newSession', async () => {
    const h = makeAcpHarness();
    const rt = new AcpSessionRuntime(h.deps);
    h.agent.loadSession.mockRejectedValue(new Error('load failed'));
    h.agent.newSession.mockResolvedValue({ sessionId: 'sess-fallback' });
    h.agent.setSessionConfigOption.mockResolvedValue({ configOptions: [] });

    await rt.start(
      makeStartInput({
        conversationId: 'conv-1',
        sessionId: 'old-session',
        model: 'claude-3-7-sonnet',
      })
    );

    expect(h.agent.newSession).toHaveBeenCalled();
    expect(h.agent.setSessionConfigOption).toHaveBeenCalledWith(
      expect.objectContaining({ configId: 'model', value: 'claude-3-7-sonnet' })
    );
  });

  it('setModel calls setSessionConfigOption but does not write to persistModel', async () => {
    const h = makeAcpHarness();
    const rt = new AcpSessionRuntime(h.deps);
    h.agent.newSession.mockResolvedValue({ sessionId: 'sess-1' });
    h.agent.setSessionConfigOption.mockResolvedValue({ configOptions: [] });

    await rt.start(makeStartInput({ conversationId: 'conv-1' }));
    h.agent.setSessionConfigOption.mockClear();

    await rt.setModel('conv-1', 'claude-3-5-sonnet');

    expect(h.agent.setSessionConfigOption).toHaveBeenCalledWith(
      expect.objectContaining({ configId: 'model', value: 'claude-3-5-sonnet' })
    );
    // persistModel was removed from deps — the mere absence of the property is
    // the correctness check; we verify the call count on setSessionConfigOption
    // stayed exactly at 1 (no extra persistence side-effects).
    expect(h.agent.setSessionConfigOption).toHaveBeenCalledTimes(1);
  });
});
