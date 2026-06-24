import type { PermissionOptionKind } from '@agentclientprotocol/sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  acpPermissionRequestChannel,
  acpPermissionResolvedChannel,
  acpSessionClosedChannel,
  acpSessionStateChannel,
  acpSessionUpdateChannel,
  acpTurnCommittedChannel,
} from '@shared/core/acp/acpEvents';
import { agentSessionExitedChannel } from '@shared/core/agents/agentEvents';
import { AcpSessionManager } from './acp-session-manager';
import { makeAcpHarness, makeConversation } from './acp-test-support';

// ---------------------------------------------------------------------------
// Pooling
// ---------------------------------------------------------------------------

describe('AcpSessionManager – pooling', () => {
  it('two conversations in the same workspace share one child process', async () => {
    const h = makeAcpHarness();
    const mgr = new AcpSessionManager(h.deps);

    h.agent.newSession
      .mockResolvedValueOnce({ sessionId: 'session-a' })
      .mockResolvedValueOnce({ sessionId: 'session-b' });

    await mgr.start(makeConversation({ conversationId: 'conv-a' }), 'ws-1', '/tmp/workspace');
    await mgr.start(makeConversation({ conversationId: 'conv-b' }), 'ws-1', '/tmp/workspace');

    expect(h.children).toHaveLength(1);
    expect(h.agent.newSession).toHaveBeenCalledTimes(2);
  });

  it('a third conversation in a different workspace spawns a second child', async () => {
    const h = makeAcpHarness();
    const mgr = new AcpSessionManager(h.deps);

    h.agent.newSession.mockResolvedValue({ sessionId: 'session-x' });

    await mgr.start(makeConversation({ conversationId: 'conv-a' }), 'ws-1', '/ws1');
    await mgr.start(makeConversation({ conversationId: 'conv-c' }), 'ws-2', '/ws2');

    expect(h.children).toHaveLength(2);
  });

  it('stop on one of two pooled conversations keeps the child alive', async () => {
    const h = makeAcpHarness();
    const mgr = new AcpSessionManager(h.deps);

    h.agent.newSession
      .mockResolvedValueOnce({ sessionId: 'session-a' })
      .mockResolvedValueOnce({ sessionId: 'session-b' });

    await mgr.start(makeConversation({ conversationId: 'conv-a' }), 'ws-1', '/tmp/workspace');
    await mgr.start(makeConversation({ conversationId: 'conv-b' }), 'ws-1', '/tmp/workspace');

    mgr.stop('conv-a');

    expect(h.lastChild.kill).not.toHaveBeenCalled();
    expect(mgr.isRunning('conv-b')).toBe(true);
  });

  it('stop on the last conversation kills the child', async () => {
    const h = makeAcpHarness();
    const mgr = new AcpSessionManager(h.deps);

    h.agent.newSession
      .mockResolvedValueOnce({ sessionId: 'session-a' })
      .mockResolvedValueOnce({ sessionId: 'session-b' });

    await mgr.start(makeConversation({ conversationId: 'conv-a' }), 'ws-1', '/tmp/workspace');
    await mgr.start(makeConversation({ conversationId: 'conv-b' }), 'ws-1', '/tmp/workspace');

    mgr.stop('conv-a');
    mgr.stop('conv-b');

    expect(h.lastChild.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('child exit fans out session-closed to all pooled conversations', async () => {
    const h = makeAcpHarness();
    const mgr = new AcpSessionManager(h.deps);

    h.agent.newSession
      .mockResolvedValueOnce({ sessionId: 'session-a' })
      .mockResolvedValueOnce({ sessionId: 'session-b' });

    await mgr.start(makeConversation({ conversationId: 'conv-a' }), 'ws-1', '/tmp/workspace');
    await mgr.start(makeConversation({ conversationId: 'conv-b' }), 'ws-1', '/tmp/workspace');

    h.clearEvents();
    h.lastChild.emitExit(1);

    const closed = h.emittedOn<{ conversationId: string }>(acpSessionClosedChannel);
    expect(closed.map((c) => c.conversationId).sort()).toEqual(['conv-a', 'conv-b']);

    const exited = h.emittedOn<{ conversationId: string }>(agentSessionExitedChannel);
    expect(exited.map((c) => c.conversationId).sort()).toEqual(['conv-a', 'conv-b']);

    expect(mgr.isRunning('conv-a')).toBe(false);
    expect(mgr.isRunning('conv-b')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

describe('AcpSessionManager – routing', () => {
  it('sessionUpdate routes to the correct conversationId and emits turnId + seq', async () => {
    const h = makeAcpHarness();
    const mgr = new AcpSessionManager(h.deps);

    h.agent.newSession
      .mockResolvedValueOnce({ sessionId: 'session-a' })
      .mockResolvedValueOnce({ sessionId: 'session-b' });

    await mgr.start(makeConversation({ conversationId: 'conv-a' }), 'ws-1', '/tmp/workspace');
    await mgr.start(makeConversation({ conversationId: 'conv-b' }), 'ws-1', '/tmp/workspace');

    h.clearEvents();

    await h.client().sessionUpdate({
      sessionId: 'session-b',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello' } },
    });

    const updates = h.emittedOn<{ conversationId: string; turnId: string; seq: number }>(
      acpSessionUpdateChannel
    );
    expect(updates).toHaveLength(1);
    expect(updates[0].conversationId).toBe('conv-b');
    expect(typeof updates[0].turnId).toBe('string');
    expect(typeof updates[0].seq).toBe('number');
  });

  it('reconnecting with a providerSessionId calls loadSession and emits a replay turn', async () => {
    const h = makeAcpHarness();
    const mgr = new AcpSessionManager(h.deps);

    const conv = makeConversation({
      conversationId: 'conv-replay',
      providerSessionId: 'existing-session-42',
    });

    await mgr.start(conv, 'ws-1', '/tmp/workspace');

    expect(h.agent.loadSession).toHaveBeenCalledWith({
      sessionId: 'existing-session-42',
      cwd: '/tmp/workspace',
      mcpServers: [],
    });
    expect(h.agent.newSession).not.toHaveBeenCalled();

    const lifecycles = h
      .emittedOn<{ lifecycle: string }>(acpSessionStateChannel)
      .map((e) => e.lifecycle);
    expect(lifecycles).toContain('replaying');
    expect(lifecycles).toContain('ready');

    const committed = h.emittedOn<{
      conversationId: string;
      turn: { source: string; status: string };
    }>(acpTurnCommittedChannel);
    expect(committed).toHaveLength(1);
    expect(committed[0]).toMatchObject({
      conversationId: 'conv-replay',
      turn: expect.objectContaining({ source: 'replay', status: 'complete' }),
    });
  });

  it('falls back to newSession when loadSession throws; replay turn committed as complete', async () => {
    const h = makeAcpHarness();
    const mgr = new AcpSessionManager(h.deps);

    h.agent.loadSession = vi.fn().mockRejectedValue(new Error('load failed'));
    h.agent.newSession = vi.fn().mockResolvedValue({ sessionId: 'fallback-session' });

    const conv = makeConversation({
      conversationId: 'conv-fallback',
      providerSessionId: 'bad-session',
    });

    await mgr.start(conv, 'ws-1', '/tmp/workspace');

    expect(h.agent.loadSession).toHaveBeenCalled();
    expect(h.agent.newSession).toHaveBeenCalled();
    expect(mgr.isRunning('conv-fallback')).toBe(true);

    const committed = h.emittedOn<{ turn: { source: string; status: string } }>(
      acpTurnCommittedChannel
    );
    expect(committed).toHaveLength(1);
    expect(committed[0].turn).toMatchObject({ source: 'replay', status: 'complete' });
  });

  it('loadSession replay: agent-assigned session ID is dynamically registered and routed', async () => {
    const h = makeAcpHarness();
    const mgr = new AcpSessionManager(h.deps);

    h.agent.loadSession = vi.fn().mockImplementation(async () => {
      // Agent sends a sessionUpdate with a different session ID than requested.
      await h.client().sessionUpdate({
        sessionId: 'agent-assigned-session-99',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } },
      });
      return {};
    });
    h.agent.newSession = vi.fn();

    const conv = makeConversation({
      conversationId: 'conv-dynamic',
      providerSessionId: 'stored-session-id',
    });

    await mgr.start(conv, 'ws-1', '/tmp/workspace');

    const updates = h.emittedOn<{ conversationId: string }>(acpSessionUpdateChannel);
    expect(updates).toHaveLength(1);
    expect(updates[0].conversationId).toBe('conv-dynamic');

    expect(h.agent.newSession).not.toHaveBeenCalled();
    expect(h.deps.setProviderSessionId).toHaveBeenCalledWith(
      'conv-dynamic',
      'agent-assigned-session-99'
    );
    expect(mgr.isRunning('conv-dynamic')).toBe(true);
  });

  it('sessionUpdate for unknown sessionId does not emit an event', async () => {
    const h = makeAcpHarness();
    const mgr = new AcpSessionManager(h.deps);

    h.agent.newSession = vi.fn().mockResolvedValue({ sessionId: 'session-a' });
    await mgr.start(makeConversation({ conversationId: 'conv-a' }), 'ws-1', '/tmp/workspace');

    h.clearEvents();

    await h.client().sessionUpdate({
      sessionId: 'unknown-session-xyz',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ghost' } },
    });

    expect(h.emittedOn(acpSessionUpdateChannel)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Turn model
// ---------------------------------------------------------------------------

describe('AcpSessionManager – turn model', () => {
  it('prompt() opens a live turn, commits it as complete on end_turn stopReason', async () => {
    const h = makeAcpHarness();
    const mgr = new AcpSessionManager(h.deps);

    h.agent.newSession = vi.fn().mockResolvedValue({ sessionId: 'session-1' });
    await mgr.start(makeConversation({ conversationId: 'conv-1' }), 'ws-1', '/tmp');

    h.clearEvents();
    h.agent.prompt = vi.fn().mockResolvedValue({ stopReason: 'end_turn' });

    await mgr.prompt('conv-1', 'hello');

    const lifecycles = h
      .emittedOn<{ lifecycle: string }>(acpSessionStateChannel)
      .map((e) => e.lifecycle);
    expect(lifecycles).toContain('working');
    expect(lifecycles).toContain('ready');

    const committed = h.emittedOn<{
      conversationId: string;
      turn: { source: string; status: string };
    }>(acpTurnCommittedChannel);
    expect(committed).toHaveLength(1);
    expect(committed[0]).toMatchObject({
      conversationId: 'conv-1',
      turn: expect.objectContaining({ source: 'live', status: 'complete' }),
    });
  });

  it('prompt() commits turn as cancelled when stopReason is cancelled', async () => {
    const h = makeAcpHarness();
    const mgr = new AcpSessionManager(h.deps);

    h.agent.newSession = vi.fn().mockResolvedValue({ sessionId: 'session-1' });
    await mgr.start(makeConversation({ conversationId: 'conv-1' }), 'ws-1', '/tmp');

    h.clearEvents();
    h.agent.prompt = vi.fn().mockResolvedValue({ stopReason: 'cancelled' });

    await mgr.prompt('conv-1', 'hi');

    const committed = h.emittedOn<{ turn: { status: string } }>(acpTurnCommittedChannel);
    expect(committed).toHaveLength(1);
    expect(committed[0].turn.status).toBe('cancelled');
  });

  it('prompt() commits turn as error when prompt() rejects', async () => {
    const h = makeAcpHarness();
    const mgr = new AcpSessionManager(h.deps);

    h.agent.newSession = vi.fn().mockResolvedValue({ sessionId: 'session-1' });
    await mgr.start(makeConversation({ conversationId: 'conv-1' }), 'ws-1', '/tmp');

    h.clearEvents();
    h.agent.prompt = vi.fn().mockRejectedValue(new Error('boom'));

    await mgr.prompt('conv-1', 'fail');

    const committed = h.emittedOn<{ turn: { status: string } }>(acpTurnCommittedChannel);
    expect(committed).toHaveLength(1);
    expect(committed[0].turn.status).toBe('error');
  });

  it('getChatHistory returns only committed turns and correct complete flag', async () => {
    const h = makeAcpHarness();
    const mgr = new AcpSessionManager(h.deps);

    h.agent.newSession = vi.fn().mockResolvedValue({ sessionId: 'session-hist' });

    expect(mgr.getChatHistory('no-such-conv')).toEqual({ turns: [], complete: true });

    await mgr.start(makeConversation({ conversationId: 'conv-hist' }), 'ws-1', '/tmp');

    let history = mgr.getChatHistory('conv-hist');
    expect(history.turns).toHaveLength(0);
    expect(history.complete).toBe(true);

    h.agent.prompt = vi.fn().mockResolvedValue({ stopReason: 'end_turn' });
    await mgr.prompt('conv-hist', 'hello');

    history = mgr.getChatHistory('conv-hist');
    expect(history.turns).toHaveLength(1);
    expect(history.turns[0].status).toBe('complete');
    expect(history.complete).toBe(true);
  });

  it('getSessionState returns active turn mid-prompt', async () => {
    const h = makeAcpHarness();
    const mgr = new AcpSessionManager(h.deps);

    h.agent.newSession = vi.fn().mockResolvedValue({ sessionId: 'session-state' });
    await mgr.start(makeConversation({ conversationId: 'conv-state' }), 'ws-1', '/tmp');

    let resolvePrompt!: (val: { stopReason: string }) => void;
    h.agent.prompt = vi.fn().mockReturnValue(
      new Promise((res) => {
        resolvePrompt = res;
      })
    );

    const promptPromise = mgr.prompt('conv-state', 'hi');

    const stateMidFlight = mgr.getSessionState('conv-state');
    expect(stateMidFlight.lifecycle).toBe('working');
    expect(stateMidFlight.activeTurn).not.toBeNull();
    expect(stateMidFlight.activeTurn?.status).toBe('active');

    resolvePrompt({ stopReason: 'end_turn' });
    await promptPromise;

    const stateAfter = mgr.getSessionState('conv-state');
    expect(stateAfter.lifecycle).toBe('ready');
    expect(stateAfter.activeTurn).toBeNull();
  });

  it('sessionUpdate attributes to active turn with incrementing seq and emits turnId', async () => {
    const h = makeAcpHarness();
    const mgr = new AcpSessionManager(h.deps);

    h.agent.newSession = vi.fn().mockResolvedValue({ sessionId: 'session-buf' });
    await mgr.start(makeConversation({ conversationId: 'conv-buf' }), 'ws-1', '/tmp/workspace');

    h.clearEvents();

    await h.client().sessionUpdate({
      sessionId: 'session-buf',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'a' } },
    });
    await h.client().sessionUpdate({
      sessionId: 'session-buf',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'b' } },
    });

    const updates = h.emittedOn<{ seq: number; turnId: string }>(acpSessionUpdateChannel);
    expect(updates).toHaveLength(2);
    expect(updates[0].seq).toBe(0);
    expect(updates[1].seq).toBe(1);
    expect(updates[0].turnId).toBe(updates[1].turnId);

    const state = mgr.getSessionState('conv-buf');
    expect(state.activeTurn?.updates).toHaveLength(2);
    expect(state.activeTurn?.updates[0].seq).toBe(0);
    expect(state.activeTurn?.updates[1].seq).toBe(1);
  });

  it('getChatHistory returns empty complete result for unknown conversation', () => {
    const h = makeAcpHarness();
    const mgr = new AcpSessionManager(h.deps);
    expect(mgr.getChatHistory('no-such-conversation')).toEqual({ turns: [], complete: true });
  });
});

// ---------------------------------------------------------------------------
// Permission requests
// ---------------------------------------------------------------------------

describe('AcpSessionManager – permission requests', () => {
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
    const mgr = new AcpSessionManager(h.deps);

    h.agent.newSession = vi.fn().mockResolvedValue({ sessionId: 'session-perm' });
    h.agent.prompt = vi.fn().mockReturnValue(new Promise(() => {}));
    await mgr.start(makeConversation({ conversationId: 'conv-perm' }), 'ws-1', '/tmp');

    let settled = false;
    const permPromise = h
      .client()
      .requestPermission(makePermissionParams('session-perm'))
      .then(() => {
        settled = true;
      });

    await Promise.resolve();
    expect(settled).toBe(false);

    const requests = h.emittedOn<{
      conversationId: string;
      requestId: string;
      title: string;
      toolKind: string;
    }>(acpPermissionRequestChannel);
    expect(requests).toHaveLength(1);
    expect(requests[0].conversationId).toBe('conv-perm');
    expect(requests[0].title).toBe('Read a File');
    expect(requests[0].toolKind).toBe('read');
    expect(typeof requests[0].requestId).toBe('string');

    const state = mgr.getSessionState('conv-perm');
    expect(state.pendingPermissions).toHaveLength(1);
    expect(state.pendingPermissions[0].title).toBe('Read a File');

    mgr.resolvePermission('conv-perm', requests[0].requestId, 'allow-once');
    await permPromise;
  });

  it('resolvePermission fulfils the promise with the chosen optionId', async () => {
    const h = makeAcpHarness();
    const mgr = new AcpSessionManager(h.deps);

    h.agent.newSession = vi.fn().mockResolvedValue({ sessionId: 'session-perm' });
    h.agent.prompt = vi.fn().mockReturnValue(new Promise(() => {}));
    await mgr.start(makeConversation({ conversationId: 'conv-resolve' }), 'ws-1', '/tmp');

    const resultPromise: Promise<{ outcome: { outcome: string; optionId?: string } }> = h
      .client()
      .requestPermission(makePermissionParams('session-perm'));

    const requests = h.emittedOn<{ requestId: string }>(acpPermissionRequestChannel);
    const requestId = requests[0].requestId;

    mgr.resolvePermission('conv-resolve', requestId, 'allow-once');

    const result = await resultPromise;
    expect(result.outcome).toEqual({ outcome: 'selected', optionId: 'allow-once' });

    const resolved = h.emittedOn<{ conversationId: string; requestId: string }>(
      acpPermissionResolvedChannel
    );
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({ conversationId: 'conv-resolve', requestId });

    expect(mgr.getSessionState('conv-resolve').pendingPermissions).toHaveLength(0);
  });

  it('resolvePermission with null sends outcome:cancelled', async () => {
    const h = makeAcpHarness();
    const mgr = new AcpSessionManager(h.deps);

    h.agent.newSession = vi.fn().mockResolvedValue({ sessionId: 'session-perm' });
    h.agent.prompt = vi.fn().mockReturnValue(new Promise(() => {}));
    await mgr.start(makeConversation({ conversationId: 'conv-cancel' }), 'ws-1', '/tmp');

    const resultPromise: Promise<{ outcome: { outcome: string } }> = h
      .client()
      .requestPermission(makePermissionParams('session-perm'));

    const requests = h.emittedOn<{ requestId: string }>(acpPermissionRequestChannel);
    const requestId = requests[0].requestId;

    mgr.resolvePermission('conv-cancel', requestId, null);
    const result = await resultPromise;
    expect(result.outcome).toEqual({ outcome: 'cancelled' });
  });

  it('resolvePermission is idempotent: second call is a no-op', async () => {
    const h = makeAcpHarness();
    const mgr = new AcpSessionManager(h.deps);

    h.agent.newSession = vi.fn().mockResolvedValue({ sessionId: 'session-perm' });
    h.agent.prompt = vi.fn().mockReturnValue(new Promise(() => {}));
    await mgr.start(makeConversation({ conversationId: 'conv-idem' }), 'ws-1', '/tmp');

    const resultPromise = h.client().requestPermission(makePermissionParams('session-perm'));
    const requests = h.emittedOn<{ requestId: string }>(acpPermissionRequestChannel);
    const requestId = requests[0].requestId;

    mgr.resolvePermission('conv-idem', requestId, 'allow-once');
    await resultPromise;

    h.clearEvents();
    // Second call: resolver is gone — no-op.
    mgr.resolvePermission('conv-idem', requestId, 'allow-once');
    expect(h.emittedOn(acpPermissionResolvedChannel)).toHaveLength(0);
  });

  it('stop() drains pending permissions with cancelled outcome', async () => {
    const h = makeAcpHarness();
    const mgr = new AcpSessionManager(h.deps);

    h.agent.newSession = vi.fn().mockResolvedValue({ sessionId: 'session-perm' });
    h.agent.prompt = vi.fn().mockReturnValue(new Promise(() => {}));
    await mgr.start(makeConversation({ conversationId: 'conv-stop' }), 'ws-1', '/tmp');

    const resultPromise: Promise<{ outcome: { outcome: string } }> = h
      .client()
      .requestPermission(makePermissionParams('session-perm'));

    const requests = h.emittedOn<{ requestId: string }>(acpPermissionRequestChannel);
    const requestId = requests[0].requestId;

    mgr.stop('conv-stop');

    const result = await resultPromise;
    expect(result.outcome).toEqual({ outcome: 'cancelled' });

    const resolved = h.emittedOn<{ requestId: string }>(acpPermissionResolvedChannel);
    expect(resolved.some((r) => r.requestId === requestId)).toBe(true);
  });

  it('getSessionState includes pendingPermissions for reload rehydration', async () => {
    const h = makeAcpHarness();
    const mgr = new AcpSessionManager(h.deps);

    h.agent.newSession = vi.fn().mockResolvedValue({ sessionId: 'session-perm' });
    h.agent.prompt = vi.fn().mockReturnValue(new Promise(() => {}));
    await mgr.start(makeConversation({ conversationId: 'conv-rehydrate' }), 'ws-1', '/tmp');

    const p1 = h.client().requestPermission(makePermissionParams('session-perm', 'tool-1'));
    const p2 = h.client().requestPermission(makePermissionParams('session-perm', 'tool-2'));

    expect(mgr.getSessionState('conv-rehydrate').pendingPermissions).toHaveLength(2);

    const requests = h.emittedOn<{ requestId: string }>(acpPermissionRequestChannel);
    mgr.resolvePermission('conv-rehydrate', requests[0].requestId, 'allow-once');
    mgr.resolvePermission('conv-rehydrate', requests[1].requestId, 'allow-once');
    await Promise.all([p1, p2]);
  });

  // New test enabled by FakeChildProcess.emitExit
  it('child crash drains pending permissions with cancelled outcome', async () => {
    const h = makeAcpHarness();
    const mgr = new AcpSessionManager(h.deps);

    h.agent.newSession = vi.fn().mockResolvedValue({ sessionId: 'session-crash' });
    h.agent.prompt = vi.fn().mockReturnValue(new Promise(() => {}));
    await mgr.start(makeConversation({ conversationId: 'conv-crash' }), 'ws-1', '/tmp');

    const resultPromise: Promise<{ outcome: { outcome: string } }> = h
      .client()
      .requestPermission(makePermissionParams('session-crash'));

    expect(mgr.getSessionState('conv-crash').pendingPermissions).toHaveLength(1);

    // Simulate the adapter process crashing.
    h.lastChild.emitExit(1);

    const result = await resultPromise;
    expect(result.outcome).toEqual({ outcome: 'cancelled' });
    expect(mgr.isRunning('conv-crash')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// beforeEach: restore vi mocks on agent between tests that mutate them
// ---------------------------------------------------------------------------

// Individual tests mutate h.agent.* fns — this is intentional, each test
// creates a fresh harness+manager via makeAcpHarness(), so there is no
// shared state to reset. The describe blocks above intentionally have no
// beforeEach for this reason.
