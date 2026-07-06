import { MessageChannel } from 'node:worker_threads';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/message-port';
import type { SessionUpdate } from '@agentclientprotocol/sdk';
import type { Client } from '@orpc/client';
import { describe, expect, it, vi } from 'vitest';
import { FakeAcpTerminalProcess, makeAcpHarness, makeStartInput } from '../acp-test-support';
import { AcpRuntime } from '../runtime/runtime';
import { createAcpRouter, serveAcpPort } from './router';

type Proc<I = unknown, O = unknown> = Client<Record<never, never>, I, O, unknown>;

type TestAcpClient = {
  startSession: Proc<{ input: ReturnType<typeof makeStartInput> }>;
  sendPrompt: Proc<{ conversationId: string; prompt: { text: string } }>;
  live: {
    sessionState: {
      snapshot: Proc<{ conversationId: string }, { data: { lifecycle: string } }>;
    };
    activeTurn: {
      subscribe: Proc<{ conversationId: string }, AsyncIterator<{ delta: unknown }>>;
    };
    terminals: {
      snapshot: Proc<{ conversationId: string }, { data: Array<{ terminalId: string; command: string }> }>;
    };
    terminalOutput: {
      snapshot: Proc<{ terminalId: string }, { data: { text: string } }>;
      subscribe: Proc<{ terminalId: string }, AsyncIterator<{ delta: unknown }>>;
    };
  };
};

function makeClient(runtime: AcpRuntime) {
  const { port1, port2 } = new MessageChannel();
  serveAcpPort(createAcpRouter(runtime), port1);
  port1.start();
  const link = new RPCLink({ port: port2 });
  return createORPCClient<TestAcpClient>(link);
}

describe('createAcpRouter', () => {
  it('round-trips command calls over a message port', async () => {
    const h = makeAcpHarness();
    const runtime = new AcpRuntime(h.deps);
    const client = makeClient(runtime);

    const started = await client.startSession({
      input: makeStartInput({ conversationId: 'conv-router' }),
    });
    expect(started).toEqual({ success: true, data: { sessionId: 'session-1' } });

    h.agent.prompt = vi.fn().mockResolvedValue({ stopReason: 'end_turn' });
    const sent = await client.sendPrompt({
      conversationId: 'conv-router',
      prompt: { text: 'hello' },
    });

    expect(sent).toEqual({ success: true, data: { queued: false } });
    expect(h.agent.prompt).toHaveBeenCalledWith({
      sessionId: 'session-1',
      prompt: [{ type: 'text', text: 'hello' }],
    });
  });

  it('streams live model patches over a message port', async () => {
    const h = makeAcpHarness();
    const runtime = new AcpRuntime(h.deps);
    const client = makeClient(runtime);

    await client.startSession({ input: makeStartInput({ conversationId: 'conv-live-router' }) });
    const snapshot = await client.live.sessionState.snapshot({
      conversationId: 'conv-live-router',
    });
    expect(snapshot.data.lifecycle).toBe('ready');

    const updates = await client.live.activeTurn.subscribe({ conversationId: 'conv-live-router' });
    let resolvePrompt!: (value: { stopReason: 'end_turn' }) => void;
    h.agent.prompt = vi.fn(
      () =>
        new Promise<{ stopReason: 'end_turn' }>((resolve) => {
          resolvePrompt = resolve;
        })
    );
    const prompt = client.sendPrompt({
      conversationId: 'conv-live-router',
      prompt: { text: 'hello' },
    });
    await h.client().sessionUpdate({
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        sessionId: 'session-1',
        messageId: 'msg-1',
        content: { type: 'text', text: 'hi' },
      } as SessionUpdate,
    });

    const update = await updates.next();
    expect(update.done).toBe(false);
    expect(update.value.delta).toBeTruthy();
    await vi.waitFor(() => expect(h.agent.prompt).toHaveBeenCalled());
    resolvePrompt({ stopReason: 'end_turn' });
    await prompt;
    await updates.return?.(undefined);
  });

  it('serves terminal metadata through LiveModel and output through LiveLog', async () => {
    const h = makeAcpHarness();
    const runtime = new AcpRuntime(h.deps);
    const client = makeClient(runtime);

    await client.startSession({ input: makeStartInput({ conversationId: 'conv-terminal-router' }) });
    const terminal = new FakeAcpTerminalProcess();
    h.fakeHost.nextTerminal = terminal;
    const created = await h.client().createTerminal!({
      sessionId: 'session-1',
      command: 'echo',
      args: [],
      cwd: '/tmp',
    });

    const terminalSnapshot = await client.live.terminals.snapshot({
      conversationId: 'conv-terminal-router',
    });
    expect(terminalSnapshot.data).toMatchObject([
      { terminalId: created.terminalId, command: 'echo' },
    ]);

    const logUpdates = await client.live.terminalOutput.subscribe({
      terminalId: created.terminalId,
    });
    terminal.pushOutput('hello');
    const update = await logUpdates.next();
    expect(update.done).toBe(false);
    expect(update.value.delta).toEqual({ chunk: 'hello' });

    const logSnapshot = await client.live.terminalOutput.snapshot({
      terminalId: created.terminalId,
    });
    expect(logSnapshot.data.text).toBe('hello');
    await logUpdates.return?.(undefined);
  });
});
