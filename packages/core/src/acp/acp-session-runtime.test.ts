import type { PermissionOptionKind, SessionUpdate } from '@agentclientprotocol/sdk';
import { describe, expect, it, vi } from 'vitest';
import { AcpSessionRuntime } from './acp-session-runtime';
import {
  FakeAcpAgent,
  FakeAcpTerminalProcess,
  makeAcpHarness,
  makeStartInput,
} from './acp-test-support';
import type { NormalizedEvent } from './reducer/normalized-event';

async function startHarness(conversationId = 'conv-1') {
  const h = makeAcpHarness();
  const rt = new AcpSessionRuntime(h.deps);
  await rt.start(makeStartInput({ conversationId }));
  return { h, rt, client: h.client(), sessionId: 'session-1', conversationId };
}

describe('AcpSessionRuntime - pooling', () => {
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

  it('stop on the last pooled conversation kills the child', async () => {
    const h = makeAcpHarness();
    const rt = new AcpSessionRuntime(h.deps);

    h.agent.newSession
      .mockResolvedValueOnce({ sessionId: 'session-a' })
      .mockResolvedValueOnce({ sessionId: 'session-b' });

    await rt.start(makeStartInput({ conversationId: 'conv-a', workspaceId: 'ws-1' }));
    await rt.start(makeStartInput({ conversationId: 'conv-b', workspaceId: 'ws-1' }));

    rt.stop('conv-a');
    expect(h.lastChild.kill).not.toHaveBeenCalled();
    rt.stop('conv-b');
    expect(h.lastChild.kill).toHaveBeenCalledWith('SIGTERM');
  });
});

describe('AcpSessionRuntime - transcript projection', () => {
  it('sessionUpdate projects into transcript snapshots', async () => {
    const { h, rt, client, sessionId } = await startHarness('conv-transcript');
    let resolvePrompt!: (value: { stopReason: 'end_turn' }) => void;
    h.agent.prompt = vi.fn(
      () =>
        new Promise<{ stopReason: 'end_turn' }>((resolve) => {
          resolvePrompt = resolve;
        })
    );
    const promptPromise = rt.prompt('conv-transcript', { text: 'hello' });

    await client.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        sessionId,
        messageId: 'msg-1',
        content: { type: 'text', text: 'hello' },
      } as SessionUpdate,
    });

    expect(h.recording.transcripts.at(-1)?.conversationId).toBe('conv-transcript');
    expect(h.recording.transcripts.at(-1)?.transcript.active?.items.at(-1)).toMatchObject({
      kind: 'message',
      role: 'assistant',
      text: 'hello',
    });
    expect(rt.getChatHistory('conv-transcript').active?.items.at(-1)).toMatchObject({
      kind: 'message',
      text: 'hello',
    });
    resolvePrompt({ stopReason: 'end_turn' });
    await promptPromise;
  });

  it('prompt synthesizes a user message and commits the active transcript turn', async () => {
    const h = makeAcpHarness();
    const rt = new AcpSessionRuntime(h.deps);
    h.agent.prompt = vi.fn().mockResolvedValue({ stopReason: 'end_turn' });

    await rt.start(makeStartInput({ conversationId: 'conv-prompt' }));
    await rt.prompt('conv-prompt', { text: 'hello' });

    const transcript = rt.getChatHistory('conv-prompt');
    expect(transcript.active).toBeNull();
    expect(transcript.committed).toHaveLength(1);
    expect(transcript.committed[0].items[0]).toMatchObject({
      kind: 'message',
      role: 'user',
      text: 'hello',
      streaming: false,
    });
  });

  it('folds idle-phase plan updates and settles them after quiesce', async () => {
    vi.useFakeTimers();
    try {
      const { h, client, sessionId } = await startHarness('conv-idle-plan');

      await client.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'plan',
          sessionId,
          entries: [{ content: 'Background step', status: 'in_progress', priority: 'medium' }],
        } as SessionUpdate,
      });

      expect(h.recording.snapshots.at(-1)?.snapshot.agentTurnActive).toBe(true);
      expect(h.recording.transcripts.at(-1)?.plan).toMatchObject({
        entries: [{ content: 'Background step', status: 'in_progress', priority: 'medium' }],
      });
      expect(h.recording.transcripts.at(-1)?.transcript.active?.initiator).toBe('agent');

      vi.advanceTimersByTime(300);
      await Promise.resolve();

      expect(h.recording.snapshots.at(-1)?.snapshot.agentTurnActive).toBe(false);
      expect(h.recording.transcripts.at(-1)?.transcript.active).toBeNull();
      expect(h.recording.transcripts.at(-1)?.transcript.committed.at(-1)?.outcome).toEqual({
        kind: 'done',
        reason: 'quiesced',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('queues prompts while a prompt is in flight and delivers the next after turn end', async () => {
    const h = makeAcpHarness();
    const rt = new AcpSessionRuntime(h.deps);
    let resolveFirst!: (value: { stopReason: 'end_turn' }) => void;
    h.agent.prompt = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<{ stopReason: 'end_turn' }>((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockResolvedValueOnce({ stopReason: 'end_turn' });

    await rt.start(makeStartInput({ conversationId: 'conv-queue' }));

    const first = rt.prompt('conv-queue', { text: 'first' });
    const second = await rt.prompt('conv-queue', { text: 'second' });

    expect(second.success).toBe(true);
    expect(h.agent.prompt).toHaveBeenCalledTimes(1);
    expect(rt.getSessionState('conv-queue').queuedPrompts).toEqual([
      {
        id: expect.any(String),
        text: 'second',
        createdAt: expect.any(Number),
        updatedAt: expect.any(Number),
      },
    ]);

    resolveFirst({ stopReason: 'end_turn' });
    await first;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(h.agent.prompt).toHaveBeenCalledTimes(2);
    expect(rt.getSessionState('conv-queue').queuedPrompts).toHaveLength(0);
  });
});

describe('AcpSessionRuntime - permissions', () => {
  it('brokers permission request/response through the SessionMachine', async () => {
    const { h, rt, client, sessionId } = await startHarness('conv-perm');

    const permissionPromise = client.requestPermission({
      sessionId,
      toolCall: { toolCallId: 'tool-1', title: 'Read a file', kind: 'read' },
      options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' as PermissionOptionKind }],
    });

    expect(rt.getSessionState('conv-perm').pendingPermissions).toHaveLength(1);
    expect(h.recording.snapshots.at(-1)?.snapshot.pendingPermissions[0]).toMatchObject({
      requestId: expect.any(String),
      toolCallId: 'tool-1',
    });

    const requestId = rt.getSessionState('conv-perm').pendingPermissions[0].requestId;
    const result = rt.resolvePermission('conv-perm', requestId, 'allow');
    expect(result.success).toBe(true);
    await expect(permissionPromise).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'allow' },
    });
    expect(rt.getSessionState('conv-perm').pendingPermissions).toHaveLength(0);
  });
});

describe('AcpSessionRuntime - capability ports', () => {
  it('delegates fs requests through FsPort', async () => {
    const { h, client, sessionId } = await startHarness('conv-fs');
    (h.deps.host.fs.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('file content');

    await expect(client.readTextFile!({ sessionId, path: '/tmp/a.txt' })).resolves.toEqual({
      content: 'file content',
    });
    await client.writeTextFile!({ sessionId, path: '/tmp/a.txt', content: 'new' });
    expect(h.deps.host.fs.writeFile).toHaveBeenCalledWith('/tmp/a.txt', 'new', 'utf8');
  });

  it('delegates terminal requests through TerminalPort', async () => {
    const { h, client, sessionId } = await startHarness('conv-term');
    const terminal = new FakeAcpTerminalProcess();
    h.fakeHost.nextTerminal = terminal;

    const created = await client.createTerminal!({
      sessionId,
      command: 'echo',
      args: ['hi'],
      cwd: '/tmp',
    });
    terminal.pushOutput('hello');

    await expect(
      client.terminalOutput!({ sessionId, terminalId: created.terminalId })
    ).resolves.toMatchObject({
      output: 'hello',
      truncated: false,
    });
  });
});

describe('AcpSessionRuntime - metadata and enrich', () => {
  it('usage_update updates the parser-owned transcript payload metadata', async () => {
    const { h, client, sessionId } = await startHarness('conv-usage');

    await client.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: 'usage_update',
        sessionId,
        used: 10,
        size: 100,
        cost: { amount: 1.25, currency: 'USD' },
      } as SessionUpdate,
    });

    expect(h.recording.transcripts.at(-1)?.usage).toEqual({
      contextUsed: 10,
      contextSize: 100,
      cost: { amount: 1.25, currency: 'USD' },
    });
  });

  it('provider enrich receives NormalizedEvent and raw SessionUpdate', async () => {
    const agent = new FakeAcpAgent();
    const enrich = vi.fn((event: NormalizedEvent) => ({
      ...event,
      ...(event.kind === 'tool_call' ? { parentToolCallId: 'parent-1' } : {}),
    }));
    const h = makeAcpHarness({
      resolveAcp: () => ({
        behavior: {
          buildSpawn: () => ({ command: '/fake/node', args: ['agent.js'], env: {} }),
          connect: agent.behavior.connect,
          enrich,
        },
      }),
    });
    const rt = new AcpSessionRuntime(h.deps);
    await rt.start(makeStartInput({ conversationId: 'conv-enrich' }));
    let resolvePrompt!: (value: { stopReason: 'end_turn' }) => void;
    agent.prompt = vi.fn(
      () =>
        new Promise<{ stopReason: 'end_turn' }>((resolve) => {
          resolvePrompt = resolve;
        })
    );
    const promptPromise = rt.prompt('conv-enrich', { text: 'run a tool' });
    const client = agent.capturedClient;
    if (!client) throw new Error('expected captured client');
    const raw = {
      sessionUpdate: 'tool_call',
      sessionId: 'session-1',
      toolCallId: 'tool-1',
      title: 'Run bash',
      kind: 'execute',
      status: 'in_progress',
      content: [],
    } as unknown as SessionUpdate;

    await client.sessionUpdate({ sessionId: 'session-1', update: raw });

    expect(enrich).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'tool_call', toolCallId: 'tool-1' }),
      raw
    );
    expect(h.recording.transcripts.at(-1)?.transcript.active?.items[0]).toMatchObject({
      kind: 'message',
    });
    expect(h.recording.transcripts.at(-1)?.transcript.active?.items.at(-1)).toMatchObject({
      kind: 'execute-tool-call',
      parentId: 'conv-enrich:turn:0:tool:parent-1',
    });
    resolvePrompt({ stopReason: 'end_turn' });
    await promptPromise;
  });
});
