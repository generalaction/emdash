import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { isOk } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import { FakeAcpTerminalProcess, makeAcpHarness, makeStartInput } from '../acp-test-support';
import { AcpRuntime } from './runtime';

async function startHarness(conversationId = 'conv-1') {
  const h = makeAcpHarness();
  const rt = new AcpRuntime(h.deps);
  const result = await rt.startSession(makeStartInput({ conversationId }));
  expect(isOk(result)).toBe(true);
  return { h, rt, client: h.client(), sessionId: 'session-1', conversationId };
}

describe('AcpRuntime session manager', () => {
  it('shares one process for conversations in the same provider/workspace and releases on last stop', async () => {
    const h = makeAcpHarness();
    const rt = new AcpRuntime(h.deps);
    h.agent.newSession
      .mockResolvedValueOnce({ sessionId: 'session-a' })
      .mockResolvedValueOnce({ sessionId: 'session-b' });

    await rt.startSession(makeStartInput({ conversationId: 'conv-a', workspaceId: 'ws-1' }));
    await rt.startSession(makeStartInput({ conversationId: 'conv-b', workspaceId: 'ws-1' }));

    expect(h.children).toHaveLength(1);
    rt.stopSession('conv-a');
    expect(h.lastChild.kill).not.toHaveBeenCalled();
    rt.stopSession('conv-b');
    expect(h.lastChild.kill).toHaveBeenCalledWith('SIGTERM');
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
    const unsubscribe = live.activeTurn.subscribe((update) => updates.push(update));

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
    const unsubscribe = live.usage.subscribe((update) => updates.push(update));

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

    expect(live.usage.snapshot().data).toEqual({
      contextUsed: 42_000,
      contextSize: 200_000,
      cost: { amount: 0.25, currency: 'USD' },
    });
    expect(updates.length).toBeGreaterThan(0);
    unsubscribe();
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

    expect(rt.terminalsLiveModel('conv-terminal').snapshot().data).toMatchObject([
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
    expect(rt.terminalsLiveModel('conv-terminal').snapshot().data).toMatchObject([
      { terminalId: created.terminalId, exitStatus: { exitCode: 0, signal: null } },
    ]);
    unsub();
  });

  it('removes sessions when the process closes', async () => {
    const { h, rt } = await startHarness('conv-close');

    h.lastChild.emitExit(42);

    expect(rt.getSessionState('conv-close').lifecycle).toBe('closed');
    expect(rt.sessionLiveModels('conv-close')).toBeNull();
    expect(rt.sessionsListLiveModel().snapshot().data).toEqual({});
  });
});
