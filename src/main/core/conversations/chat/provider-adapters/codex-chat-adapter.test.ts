import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationPermissionRequestTimelineItem } from '@shared/conversation-timeline';
import type { Conversation } from '@shared/conversations';
import type { ChatProviderRuntimeEvent } from '../types';
import { CodexChatAdapter } from './codex-chat-adapter';

type JsonMessage = Record<string, unknown>;

class FakeCodexChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin: Writable;
  killed = false;
  readonly clientRequests: JsonMessage[] = [];
  readonly serverResponses: JsonMessage[] = [];

  private readonly handlers = new Map<string, (params: unknown) => unknown>();

  constructor() {
    super();
    this.stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        for (const line of chunk.toString().split('\n')) {
          if (!line.trim()) continue;
          const message = JSON.parse(line) as JsonMessage;
          if (typeof message.method === 'string') {
            this.clientRequests.push(message);
            const response = this.handlers.get(message.method)?.(message.params) ?? {};
            this.writeStdout({ id: message.id, result: response });
          } else {
            this.serverResponses.push(message);
          }
        }
        callback();
      },
    });
  }

  handle(method: string, handler: (params: unknown) => unknown): void {
    this.handlers.set(method, handler);
  }

  notify(method: string, params: unknown): void {
    this.writeStdout({ method, params });
  }

  request(id: number, method: string, params: unknown): void {
    this.writeStdout({ id, method, params });
  }

  exit(errorText = 'server died'): void {
    this.stderr.write(errorText);
    this.emit('exit', 1, null);
  }

  kill(): boolean {
    this.killed = true;
    return true;
  }

  private writeStdout(message: JsonMessage): void {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }
}

let fakeChild: FakeCodexChild;

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual('node:child_process');
  return {
    ...actual,
    execFile: vi.fn(
      (
        _command: string,
        _args: string[],
        callback: (error: Error | null, stdout: string, stderr: string) => void
      ) => {
        callback(null, 'codex 0.128.0', '');
        return {};
      }
    ),
    spawn: vi.fn(() => fakeChild),
  };
});

vi.mock('@main/core/settings/provider-settings-service', () => ({
  providerOverrideSettings: {
    getItem: vi.fn(async () => ({ cli: 'codex' })),
  },
}));

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conversation-1',
    projectId: 'project-1',
    taskId: 'task-1',
    providerId: 'codex',
    title: 'Conversation 1',
    lastInteractedAt: null,
    isInitialConversation: false,
    runtimeMode: 'chat',
    ...overrides,
  };
}

function setupFakeChild(): void {
  fakeChild = new FakeCodexChild();
  fakeChild.handle('initialize', () => ({}));
  fakeChild.handle('thread/start', () => ({ thread: { id: 'thread-1' } }));
  fakeChild.handle('thread/loaded/list', () => ({ data: [] }));
  fakeChild.handle('thread/resume', () => ({}));
  fakeChild.handle('turn/start', () => ({}));
  fakeChild.handle('turn/interrupt', () => ({}));
  fakeChild.handle('thread/compact/start', () => ({}));
  fakeChild.handle('thread/goal/set', () => ({}));
  fakeChild.handle('thread/goal/clear', () => ({}));
}

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

async function createSession(
  events: ChatProviderRuntimeEvent[] = [],
  conversationOverrides: Partial<Conversation> = {}
) {
  const adapter = new CodexChatAdapter();
  const session = await adapter.createSession({
    conversation: makeConversation(conversationOverrides),
    cwd: '/tmp/project',
    env: {},
    onEvent: (event) => {
      events.push(event);
    },
  });
  return { adapter, session };
}

describe('CodexChatAdapter app-server integration', () => {
  beforeEach(() => {
    setupFakeChild();
  });

  it('initializes app-server and sends valid Codex sandbox policy for turns', async () => {
    const events: ChatProviderRuntimeEvent[] = [];
    const { adapter, session } = await createSession(events);

    await adapter.sendMessage(session, { text: 'hello' });
    fakeChild.notify('turn/started', { threadId: 'thread-1', turn: { id: 'turn-1' } });
    fakeChild.notify('item/agentMessage/delta', { itemId: 'assistant-1', delta: 'Hi' });
    fakeChild.notify('item/reasoning/summaryTextDelta', {
      itemId: 'reasoning-1',
      delta: 'Thinking',
    });
    fakeChild.notify('turn/completed', { threadId: 'thread-1', turn: { status: 'completed' } });

    await vi.waitFor(() => {
      expect(events).toContainEqual({ type: 'status', status: 'completed' });
    });
    expect(fakeChild.clientRequests.map((request) => request.method)).toEqual([
      'initialize',
      'initialized',
      'thread/start',
      'turn/start',
    ]);
    expect(
      fakeChild.clientRequests.find((request) => request.method === 'turn/start')
    ).toMatchObject({
      params: {
        threadId: 'thread-1',
        approvalPolicy: 'on-request',
        sandboxPolicy: { type: 'workspaceWrite', networkAccess: false },
      },
    });
    const { spawn } = await import('node:child_process');
    expect(spawn).toHaveBeenCalledWith(
      'codex',
      ['app-server', '--listen', 'stdio://', '--enable', 'goals'],
      expect.any(Object)
    );
    expect(events).toContainEqual({
      type: 'timeline',
      item: {
        id: 'assistant-1',
        kind: 'assistant_message',
        payload: { text: 'Hi' },
      },
      upsert: true,
    });
    expect(events).toContainEqual({
      type: 'timeline',
      item: {
        id: 'reasoning-1',
        kind: 'reasoning',
        payload: { text: 'Thinking' },
      },
      upsert: true,
    });
  });

  it('uses full-access app-server permissions when auto approve is enabled', async () => {
    const { adapter, session } = await createSession([], { autoApprove: true });

    await adapter.sendMessage(session, { text: 'ship it' });

    expect(
      fakeChild.clientRequests.find((request) => request.method === 'thread/start')
    ).toMatchObject({
      params: {
        approvalPolicy: 'never',
        sandbox: 'danger-full-access',
      },
    });
    expect(
      fakeChild.clientRequests.find((request) => request.method === 'turn/start')
    ).toMatchObject({
      params: {
        approvalPolicy: 'never',
        sandboxPolicy: { type: 'dangerFullAccess' },
      },
    });
  });

  it('resumes only unloaded persisted Codex threads', async () => {
    fakeChild.handle('thread/loaded/list', () => ({ data: ['thread-1'] }));
    const adapter = new CodexChatAdapter();

    const session = await adapter.resumeSession({
      conversation: makeConversation({ providerSessionId: 'thread-1' }),
      cwd: '/tmp/project',
      env: {},
      onEvent: vi.fn(),
    });

    expect(session.providerSessionId).toBe('thread-1');
    expect(fakeChild.clientRequests.map((request) => request.method)).toEqual([
      'initialize',
      'initialized',
      'thread/loaded/list',
    ]);
  });

  it('resumes unloaded persisted Codex threads', async () => {
    fakeChild.handle('thread/loaded/list', () => ({ data: [] }));
    const adapter = new CodexChatAdapter();

    const session = await adapter.resumeSession({
      conversation: makeConversation({ providerSessionId: 'thread-2' }),
      cwd: '/tmp/project',
      env: {},
      onEvent: vi.fn(),
    });

    expect(session.providerSessionId).toBe('thread-2');
    expect(fakeChild.clientRequests.map((request) => request.method)).toEqual([
      'initialize',
      'initialized',
      'thread/loaded/list',
      'thread/resume',
    ]);
    expect(
      fakeChild.clientRequests.find((request) => request.method === 'thread/resume')
    ).toMatchObject({
      params: { threadId: 'thread-2', cwd: '/tmp/project' },
    });
  });

  it('answers app-server approval and user-input requests with method-specific result shapes', async () => {
    const events: ChatProviderRuntimeEvent[] = [];
    const { adapter, session } = await createSession(events);

    fakeChild.request(100, 'item/commandExecution/requestApproval', {
      itemId: 'cmd-1',
      command: 'pnpm test',
    });
    await vi.waitFor(() => {
      expect(
        events.some((event) => event.type === 'status' && event.status === 'awaiting-input')
      ).toBe(true);
    });
    await adapter.respondToPermission(session, permissionRequest(events, 'permission-cmd-1'), {
      requestId: 'permission-cmd-1',
      optionId: 'approve',
    });

    fakeChild.request(101, 'item/fileChange/requestApproval', {
      itemId: 'file-1',
      reason: 'Apply generated patch',
    });
    await vi.waitFor(() => {
      expect(permissionRequest(events, 'permission-file-1')).toBeDefined();
    });
    await adapter.respondToPermission(session, permissionRequest(events, 'permission-file-1'), {
      requestId: 'permission-file-1',
      optionId: 'deny',
    });

    fakeChild.request(102, 'item/tool/requestUserInput', {
      itemId: 'question-1',
      questions: [
        {
          id: 'confirm',
          options: [{ label: 'Yes (Recommended)' }, { label: 'No' }],
        },
      ],
    });
    await vi.waitFor(() => {
      expect(permissionRequest(events, 'permission-question-1')).toBeDefined();
    });
    await adapter.respondToPermission(session, permissionRequest(events, 'permission-question-1'), {
      requestId: 'permission-question-1',
      optionId: 'approve',
      answers: { confirm: 'No' },
    });

    await vi.waitFor(() => {
      expect(fakeChild.serverResponses).toContainEqual({
        id: 100,
        result: { decision: 'accept' },
      });
      expect(fakeChild.serverResponses).toContainEqual({
        id: 101,
        result: { decision: 'decline' },
      });
      expect(fakeChild.serverResponses).toContainEqual({
        id: 102,
        result: { answers: { confirm: { answers: ['No'] } } },
      });
    });
  });

  it('answers user-input requests with explicit answers and handles duplicate permission item ids', async () => {
    const events: ChatProviderRuntimeEvent[] = [];
    const { adapter, session } = await createSession(events);

    fakeChild.request(100, 'tool/requestUserInput', {
      itemId: 'question-1',
      questions: [
        {
          id: 'confirm',
          header: 'Confirm',
          multiSelect: true,
          question: 'Proceed?',
          options: [
            { label: 'Yes', description: 'Continue' },
            { label: 'Also run tests', description: 'Verify the change' },
          ],
        },
      ],
    });
    fakeChild.request(101, 'item/fileChange/requestApproval', {
      itemId: 'question-1',
      reason: 'same item id',
    });
    await vi.waitFor(() => {
      expect(permissionRequest(events, 'permission-question-1')).toBeDefined();
      expect(permissionRequest(events, 'permission-question-1-101')).toBeDefined();
    });

    await adapter.respondToPermission(session, permissionRequest(events, 'permission-question-1'), {
      requestId: 'permission-question-1',
      optionId: 'approve',
      answers: { confirm: ['Yes', 'Also run tests'] },
    });
    await adapter.respondToPermission(
      session,
      permissionRequest(events, 'permission-question-1-101'),
      {
        requestId: 'permission-question-1-101',
        optionId: 'approve',
      }
    );

    await vi.waitFor(() => {
      expect(fakeChild.serverResponses).toContainEqual({
        id: 100,
        result: { answers: { confirm: { answers: ['Yes', 'Also run tests'] } } },
      });
      expect(fakeChild.serverResponses).toContainEqual({
        id: 101,
        result: { decision: 'accept' },
      });
    });
    expect(events).toContainEqual({
      type: 'timeline',
      item: expect.objectContaining({
        id: 'permission-question-1',
        payload: expect.objectContaining({
          input: {
            questions: [
              {
                id: 'confirm',
                header: 'Confirm',
                multiSelect: true,
                question: 'Proceed?',
                options: [
                  { label: 'Yes', description: 'Continue' },
                  { label: 'Also run tests', description: 'Verify the change' },
                ],
              },
            ],
          },
        }),
      }),
      upsert: true,
    });
  });

  it('maps app-server tool item notifications and error completions into runtime events', async () => {
    const events: ChatProviderRuntimeEvent[] = [];
    await createSession(events);

    fakeChild.notify('thread/started', { thread: { id: 'thread-from-notification' } });
    fakeChild.notify('item/started', {
      item: { id: 'tool-1', type: 'exec', status: 'running', name: 'bash', output: 'start' },
    });
    fakeChild.notify('item/completed', {
      item: { id: 'tool-1', type: 'exec', status: 'cancelled', title: 'Shell', text: 'stopped' },
    });
    fakeChild.notify('item/completed', {
      item: { id: 'tool-2', type: 'exec', status: 'failed', error: 'boom' },
    });
    fakeChild.notify('item/completed', {
      item: { id: 'assistant-final', type: 'assistantMessage', text: 'ignored' },
    });
    fakeChild.notify('turn/completed', {
      threadId: 'thread-1',
      turn: { status: 'failed', error: { message: 'turn failed' } },
    });

    await vi.waitFor(() => {
      expect(events).toContainEqual({ type: 'status', status: 'error' });
    });
    expect(events).toContainEqual({
      type: 'provider-session',
      providerSessionId: 'thread-from-notification',
    });
    expect(events).toContainEqual({
      type: 'timeline',
      item: {
        id: 'tool-1',
        kind: 'tool_call',
        payload: {
          toolName: 'bash',
          status: 'running',
          output: 'start',
          error: undefined,
          input: {
            item: { id: 'tool-1', type: 'exec', status: 'running', name: 'bash', output: 'start' },
          },
        },
      },
      upsert: true,
    });
    expect(events).toContainEqual({
      type: 'timeline',
      item: expect.objectContaining({
        id: 'tool-1',
        payload: expect.objectContaining({ status: 'cancelled', output: 'stopped' }),
      }),
      upsert: true,
    });
    expect(events).toContainEqual({
      type: 'timeline',
      item: expect.objectContaining({
        id: 'tool-2',
        payload: expect.objectContaining({ status: 'failed', error: 'boom' }),
      }),
      upsert: true,
    });
    expect(events).toContainEqual({
      type: 'timeline',
      item: { kind: 'error', payload: { message: 'turn failed' } },
    });
  });

  it('serializes runtime event forwarding so streaming deltas cannot persist out of order', async () => {
    const adapter = new CodexChatAdapter();
    const handled: ChatProviderRuntimeEvent[] = [];
    const firstEvent = deferred();
    const session = await adapter.createSession({
      conversation: makeConversation(),
      cwd: '/tmp/project',
      env: {},
      onEvent: async (event) => {
        handled.push(event);
        if (
          event.type === 'timeline' &&
          event.item.kind === 'assistant_message' &&
          event.item.payload.text === 'H'
        ) {
          await firstEvent.promise;
        }
      },
    });

    fakeChild.notify('item/agentMessage/delta', { itemId: 'assistant-1', delta: 'H' });
    fakeChild.notify('item/agentMessage/delta', { itemId: 'assistant-1', delta: 'i' });

    await vi.waitFor(() => {
      expect(handled).toContainEqual({
        type: 'timeline',
        item: {
          id: 'assistant-1',
          kind: 'assistant_message',
          payload: { text: 'H' },
        },
        upsert: true,
      });
    });
    expect(handled).not.toContainEqual({
      type: 'timeline',
      item: {
        id: 'assistant-1',
        kind: 'assistant_message',
        payload: { text: 'Hi' },
      },
      upsert: true,
    });

    firstEvent.resolve();
    await vi.waitFor(() => {
      expect(handled).toContainEqual({
        type: 'timeline',
        item: {
          id: 'assistant-1',
          kind: 'assistant_message',
          payload: { text: 'Hi' },
        },
        upsert: true,
      });
    });
    await adapter.dispose(session);
  });

  it('supports explicit runtime event subscriptions', async () => {
    const { adapter, session } = await createSession([]);
    const subscribed = vi.fn();
    const unsubscribe = adapter.subscribe(session, subscribed);

    fakeChild.notify('thread/compacted', {});
    unsubscribe();
    fakeChild.notify('thread/compacted', {});

    await vi.waitFor(() => {
      expect(subscribed).toHaveBeenCalledTimes(1);
    });
    expect(subscribed).toHaveBeenCalledWith({
      type: 'timeline',
      item: { kind: 'reasoning', payload: { text: 'Context compacted.' } },
    });
  });

  it('rejects pending app-server permission requests when the session is disposed', async () => {
    const { adapter, session } = await createSession();

    fakeChild.request(100, 'item/commandExecution/requestApproval', {
      itemId: 'cmd-1',
      command: 'pnpm test',
    });
    await vi.waitFor(() => {
      expect(fakeChild.serverResponses).toHaveLength(0);
    });

    await adapter.dispose(session);

    expect(fakeChild.killed).toBe(true);
    expect(fakeChild.serverResponses).toEqual([]);
  });

  it('keeps simultaneous duplicate permission item ids independently resolvable', async () => {
    const events: ChatProviderRuntimeEvent[] = [];
    const { adapter, session } = await createSession(events);

    fakeChild.request(100, 'item/commandExecution/requestApproval', {
      itemId: 'cmd-1',
      command: 'pnpm test',
    });
    fakeChild.request(101, 'item/commandExecution/requestApproval', {
      itemId: 'cmd-1',
      command: 'pnpm lint',
    });

    await vi.waitFor(() => {
      expect(permissionRequest(events, 'permission-cmd-1')).toBeDefined();
      expect(permissionRequest(events, 'permission-cmd-1-101')).toBeDefined();
    });

    await adapter.respondToPermission(session, permissionRequest(events, 'permission-cmd-1'), {
      requestId: 'permission-cmd-1',
      optionId: 'approve',
    });
    await adapter.respondToPermission(session, permissionRequest(events, 'permission-cmd-1-101'), {
      requestId: 'permission-cmd-1-101',
      optionId: 'deny',
    });

    await vi.waitFor(() => {
      expect(fakeChild.serverResponses).toContainEqual({
        id: 100,
        result: { decision: 'accept' },
      });
      expect(fakeChild.serverResponses).toContainEqual({
        id: 101,
        result: { decision: 'decline' },
      });
    });
  });

  it('handles out-of-band slash commands without starting a turn', async () => {
    const events: ChatProviderRuntimeEvent[] = [];
    const { adapter, session } = await createSession(events);

    await expect(
      adapter.tryHandleOutOfBandCommand?.(session, { text: '/goal pause' })
    ).resolves.toBe(true);
    await expect(adapter.tryHandleOutOfBandCommand?.(session, { text: '/compact' })).resolves.toBe(
      true
    );

    expect(fakeChild.clientRequests.map((request) => request.method)).toEqual([
      'initialize',
      'initialized',
      'thread/start',
      'thread/goal/set',
      'thread/compact/start',
    ]);
    expect(
      fakeChild.clientRequests.find((request) => request.method === 'thread/goal/set')
    ).toMatchObject({
      params: { threadId: 'thread-1', status: 'paused' },
    });
    expect(fakeChild.clientRequests.some((request) => request.method === 'turn/start')).toBe(false);
    expect(events).toContainEqual({
      type: 'timeline',
      item: { kind: 'assistant_message', payload: { text: 'Goal paused.' } },
    });
    expect(
      events.filter((event) => event.type === 'status' && event.status === 'completed')
    ).toHaveLength(2);
  });

  it('does not report cancellation success before Codex reports a turn id', async () => {
    const { adapter, session } = await createSession([]);

    await adapter.sendMessage(session, { text: 'hello' });

    await expect(adapter.cancel(session)).rejects.toThrow(
      'Cannot interrupt Codex turn before app-server reports turn start'
    );
    expect(fakeChild.clientRequests.some((request) => request.method === 'turn/interrupt')).toBe(
      false
    );
  });

  it('executes every supported goal subcommand and reports usage for empty goal commands', async () => {
    const events: ChatProviderRuntimeEvent[] = [];
    const { adapter, session } = await createSession(events);

    await adapter.executeSlashCommand(session, { name: 'goal', args: 'resume' });
    await adapter.executeSlashCommand(session, { name: 'goal', args: 'clear' });
    await adapter.executeSlashCommand(session, { name: 'goal', args: 'deliver chat' });
    await adapter.executeSlashCommand(session, { name: 'goal' });

    expect(fakeChild.clientRequests.map((request) => request.method)).toEqual([
      'initialize',
      'initialized',
      'thread/start',
      'thread/goal/set',
      'thread/goal/clear',
      'thread/goal/set',
    ]);
    expect(fakeChild.clientRequests).toContainEqual(
      expect.objectContaining({
        method: 'thread/goal/set',
        params: { threadId: 'thread-1', status: 'active' },
      })
    );
    expect(fakeChild.clientRequests).toContainEqual(
      expect.objectContaining({
        method: 'thread/goal/set',
        params: { threadId: 'thread-1', objective: 'deliver chat', status: 'active' },
      })
    );
    await vi.waitFor(() => {
      expect(JSON.stringify(events)).toContain('Usage: /goal <objective>|pause|resume|clear');
    });
  });

  it('hides and does not intercept /goal when Codex goals are not enabled', async () => {
    const { execFile, spawn } = await import('node:child_process');
    vi.mocked(execFile).mockImplementationOnce((_command, _args, _options, callback) => {
      const done = typeof _options === 'function' ? _options : callback;
      if (!done) throw new Error('execFile callback missing');
      done(null, 'codex 0.127.0', '');
      return {} as ReturnType<typeof execFile>;
    });
    const { adapter, session } = await createSession([]);

    await expect(adapter.listCommands(session)).resolves.toEqual([
      { name: 'compact', description: 'Compact Codex context' },
    ]);
    await expect(
      adapter.tryHandleOutOfBandCommand?.(session, { text: '/goal pause' })
    ).resolves.toBe(false);
    expect(spawn).toHaveBeenCalledWith(
      'codex',
      ['app-server', '--listen', 'stdio://'],
      expect.any(Object)
    );
  });

  it('disables goals when Codex version detection fails', async () => {
    const { execFile, spawn } = await import('node:child_process');
    vi.mocked(execFile).mockImplementationOnce((_command, _args, _options, callback) => {
      const done = typeof _options === 'function' ? _options : callback;
      if (!done) throw new Error('execFile callback missing');
      done(new Error('version failed'), '', '');
      return {} as ReturnType<typeof execFile>;
    });

    const { adapter, session } = await createSession([]);

    await expect(adapter.listCommands(session)).resolves.toEqual([
      { name: 'compact', description: 'Compact Codex context' },
    ]);
    expect(spawn).toHaveBeenCalledWith(
      'codex',
      ['app-server', '--listen', 'stdio://'],
      expect.any(Object)
    );
  });

  it('bounds Codex version detection before spawning app-server without goals', async () => {
    vi.useFakeTimers();
    try {
      const { execFile, spawn } = await import('node:child_process');
      const kill = vi.fn();
      vi.mocked(execFile).mockImplementationOnce(
        () => ({ kill }) as unknown as ReturnType<typeof execFile>
      );

      const sessionPromise = createSession([]);
      await vi.advanceTimersByTimeAsync(2_000);
      const { adapter, session } = await sessionPromise;

      await expect(adapter.listCommands(session)).resolves.toEqual([
        { name: 'compact', description: 'Compact Codex context' },
      ]);
      expect(kill).toHaveBeenCalled();
      expect(spawn).toHaveBeenCalledWith(
        'codex',
        ['app-server', '--listen', 'stdio://'],
        expect.any(Object)
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('emits an error status when app-server exits after turn acceptance but before turn-started', async () => {
    const events: ChatProviderRuntimeEvent[] = [];
    const { adapter, session } = await createSession(events);

    await adapter.sendMessage(session, { text: 'hello' });
    fakeChild.exit('early app-server death');

    await vi.waitFor(() => {
      expect(events).toContainEqual({ type: 'status', status: 'error' });
    });
    expect(events).toContainEqual({
      type: 'timeline',
      item: {
        kind: 'error',
        payload: { message: expect.stringContaining('early app-server death') },
      },
    });
  });

  it('emits an error status when app-server exits during an active turn', async () => {
    const events: ChatProviderRuntimeEvent[] = [];
    const { adapter, session } = await createSession(events);

    await adapter.sendMessage(session, { text: 'hello' });
    fakeChild.notify('turn/started', { threadId: 'thread-1', turn: { id: 'turn-1' } });
    await vi.waitFor(() => {
      expect(events).toContainEqual({ type: 'status', status: 'working' });
    });

    fakeChild.exit('fatal app-server error');

    await vi.waitFor(() => {
      expect(events).toContainEqual({ type: 'status', status: 'error' });
    });
    expect(events).toContainEqual({
      type: 'timeline',
      item: {
        kind: 'error',
        payload: { message: expect.stringContaining('fatal app-server error') },
      },
    });
  });
});

function permissionRequest(
  events: ChatProviderRuntimeEvent[],
  requestId: string
): ConversationPermissionRequestTimelineItem {
  const event = events.find(
    (candidate) =>
      candidate.type === 'timeline' &&
      candidate.item.kind === 'permission_request' &&
      candidate.item.payload.requestId === requestId
  );
  if (!event || event.type !== 'timeline' || event.item.kind !== 'permission_request') {
    throw new Error(`Permission request ${requestId} not found`);
  }
  return {
    id: event.item.id ?? requestId,
    conversationId: 'conversation-1',
    sequence: 1,
    createdAt: '2026-05-29T00:00:00.000Z',
    kind: 'permission_request',
    ...event.item.payload,
  };
}
