import { describe, expect, it, vi } from 'vitest';
import { CodexAppServerClient } from './codex-app-server-client';

type RequestHandler = (method: string, params: unknown, requestId: number) => unknown;
type NotificationHandler = (method: string, params: unknown) => void;
type ExitHandler = (error: Error | undefined) => void;

class FakeTransport {
  exitHandler?: ExitHandler;
  notificationHandler?: NotificationHandler;
  requestHandler?: RequestHandler;
  readonly notifications: { method: string; params: unknown }[] = [];
  readonly requests: { method: string; params: unknown; timeoutMs?: number }[] = [];
  private readonly responses = new Map<string, unknown>();

  setResponse(method: string, response: unknown): void {
    this.responses.set(method, response);
  }

  setRequestHandler(handler: RequestHandler): void {
    this.requestHandler = handler;
  }

  setNotificationHandler(handler: NotificationHandler): void {
    this.notificationHandler = handler;
  }

  setExitHandler(handler: ExitHandler): void {
    this.exitHandler = handler;
  }

  request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown> {
    this.requests.push({ method, params, timeoutMs });
    return Promise.resolve(this.responses.get(method) ?? {});
  }

  notify(method: string, params?: unknown): void {
    this.notifications.push({ method, params });
  }

  dispose = vi.fn(async () => undefined);
}

describe('CodexAppServerClient', () => {
  it('initializes the app-server and wraps core JSON-RPC methods', async () => {
    const transport = new FakeTransport();
    transport.setResponse('thread/start', { thread: { id: 'thread-1' } });
    transport.setResponse('thread/loaded/list', { data: ['thread-1', 12, 'thread-2'] });
    const client = new CodexAppServerClient(transport);

    await client.initialize();
    await expect(client.startThread({ cwd: '/repo' })).resolves.toBe('thread-1');
    await client.resumeThread({ threadId: 'thread-1' });
    await expect(client.listLoadedThreads()).resolves.toEqual(['thread-1', 'thread-2']);
    await client.startTurn({
      approvalPolicy: 'on-request',
      cwd: '/repo',
      input: [{ type: 'text', text: 'hello', text_elements: [] }],
      sandboxPolicy: { type: 'workspaceWrite', networkAccess: false },
      threadId: 'thread-1',
    });
    await client.interruptTurn({ threadId: 'thread-1', turnId: 'turn-1' });
    await client.compactThread('thread-1');
    await client.setGoal('thread-1', { objective: 'ship', status: 'active' });
    await client.clearGoal('thread-1');
    await client.dispose();

    expect(transport.requests.map((request) => request.method)).toEqual([
      'initialize',
      'thread/start',
      'thread/resume',
      'thread/loaded/list',
      'turn/start',
      'turn/interrupt',
      'thread/compact/start',
      'thread/goal/set',
      'thread/goal/clear',
    ]);
    expect(transport.notifications).toEqual([{ method: 'initialized', params: {} }]);
    expect(transport.requests.find((request) => request.method === 'turn/start')).toMatchObject({
      timeoutMs: 90_000,
    });
    expect(transport.requests.find((request) => request.method === 'turn/interrupt')).toMatchObject(
      {
        timeoutMs: 2_000,
      }
    );
    expect(transport.dispose).toHaveBeenCalled();
  });

  it('parses known notifications and preserves unknown notifications', () => {
    const transport = new FakeTransport();
    const client = new CodexAppServerClient(transport);
    const notifications: unknown[] = [];
    client.onNotification((notification) => notifications.push(notification));

    transport.notificationHandler?.('thread/started', { thread: { id: 'thread-1' } });
    transport.notificationHandler?.('turn/started', {
      threadId: 'thread-1',
      turn: { id: 'turn-1' },
    });
    transport.notificationHandler?.('turn/completed', {
      threadId: 'thread-1',
      turn: { status: 'failed', error: { message: 'bad turn' } },
    });
    transport.notificationHandler?.('turn/plan/updated', {
      plan: [{ step: 'Implement chat', status: 'in_progress' }],
    });
    transport.notificationHandler?.('turn/diff/updated', { diff: 'diff --git a/a b/a' });
    transport.notificationHandler?.('thread/tokenUsage/updated', {
      tokenUsage: { totalTokens: 123 },
    });
    transport.notificationHandler?.('item/agentMessage/delta', {
      itemId: 'assistant-1',
      delta: 'Hello',
    });
    transport.notificationHandler?.('item/reasoning/summaryTextDelta', {
      itemId: 'reasoning-1',
      delta: 'Thinking',
    });
    transport.notificationHandler?.('item/started', {
      item: { id: 'tool-1', type: 'exec', status: 'running', name: 'bash' },
    });
    transport.notificationHandler?.('item/completed', {
      item: {
        id: 'tool-1',
        type: 'exec',
        status: 'failed',
        title: 'Shell',
        text: 'output',
        error: { message: 'boom' },
      },
    });
    transport.notificationHandler?.('codex/event/item_started', {
      msg: { type: 'item_started', item: { id: 'tool-3', type: 'webSearch', status: 'running' } },
    });
    transport.notificationHandler?.('codex/event/item_completed', {
      msg: {
        type: 'item_completed',
        item: { id: 'tool-3', type: 'webSearch', status: 'completed' },
      },
    });
    transport.notificationHandler?.('codex/event/exec_command_begin', {
      msg: { type: 'exec_command_begin', call_id: 'cmd-1', command: 'pnpm test', cwd: '/repo' },
    });
    transport.notificationHandler?.('codex/event/exec_command_output_delta', {
      msg: { type: 'exec_command_output_delta', call_id: 'cmd-1', stream: 'stdout', chunk: 'SGk=' },
    });
    transport.notificationHandler?.('codex/event/exec_command_end', {
      msg: {
        type: 'exec_command_end',
        call_id: 'cmd-1',
        command: 'pnpm test',
        aggregated_output: 'ok',
        exit_code: 0,
        success: true,
      },
    });
    transport.notificationHandler?.('item/commandExecution/terminalInteraction', {
      itemId: 'cmd-1',
      processId: 42,
      stdin: 'y',
    });
    transport.notificationHandler?.('codex/event/terminal_interaction', {
      msg: { type: 'terminal_interaction', call_id: 'cmd-2', process_id: '99', stdin: 'n' },
    });
    transport.notificationHandler?.('codex/event/patch_apply_begin', {
      msg: { type: 'patch_apply_begin', call_id: 'patch-1', changes: { files: [] } },
    });
    transport.notificationHandler?.('item/fileChange/outputDelta', {
      itemId: 'patch-1',
      delta: 'applied',
    });
    transport.notificationHandler?.('codex/event/patch_apply_end', {
      msg: { type: 'patch_apply_end', call_id: 'patch-1', stdout: 'done', success: true },
    });
    transport.notificationHandler?.('codex/event/turn_diff', {
      msg: { type: 'turn_diff', unified_diff: 'diff --git a/b b/b' },
    });
    transport.notificationHandler?.('codex/event/turn_aborted', {
      msg: { type: 'turn_aborted', reason: 'user_cancelled' },
    });
    transport.notificationHandler?.('codex/event/task_complete', {
      msg: { type: 'task_complete' },
    });
    transport.notificationHandler?.('thread/compacted', {});
    transport.notificationHandler?.('custom/event', { value: true });
    transport.notificationHandler?.('thread/started', { thread: {} });

    expect(notifications).toEqual([
      { type: 'thread-started', threadId: 'thread-1' },
      { type: 'turn-started', threadId: 'thread-1', turnId: 'turn-1' },
      {
        type: 'turn-completed',
        threadId: 'thread-1',
        status: 'failed',
        errorMessage: 'bad turn',
      },
      { type: 'plan-updated', plan: [{ step: 'Implement chat', status: 'in_progress' }] },
      { type: 'diff-updated', diff: 'diff --git a/a b/a' },
      { type: 'token-usage-updated', tokenUsage: { totalTokens: 123 } },
      { type: 'assistant-delta', itemId: 'assistant-1', delta: 'Hello' },
      { type: 'reasoning-delta', itemId: 'reasoning-1', delta: 'Thinking' },
      {
        type: 'item',
        phase: 'started',
        itemId: 'tool-1',
        itemType: 'exec',
        status: 'running',
        name: 'bash',
        title: undefined,
        output: undefined,
        error: undefined,
        raw: { item: { id: 'tool-1', type: 'exec', status: 'running', name: 'bash' } },
      },
      {
        type: 'item',
        phase: 'completed',
        itemId: 'tool-1',
        itemType: 'exec',
        status: 'failed',
        name: undefined,
        title: 'Shell',
        output: 'output',
        error: 'boom',
        raw: {
          item: {
            id: 'tool-1',
            type: 'exec',
            status: 'failed',
            title: 'Shell',
            text: 'output',
            error: { message: 'boom' },
          },
        },
      },
      {
        type: 'item',
        phase: 'started',
        itemId: 'tool-3',
        itemType: 'webSearch',
        status: 'running',
        name: undefined,
        title: undefined,
        output: undefined,
        error: undefined,
        raw: {
          msg: {
            type: 'item_started',
            item: { id: 'tool-3', type: 'webSearch', status: 'running' },
          },
        },
      },
      {
        type: 'item',
        phase: 'completed',
        itemId: 'tool-3',
        itemType: 'webSearch',
        status: 'completed',
        name: undefined,
        title: undefined,
        output: undefined,
        error: undefined,
        raw: {
          msg: {
            type: 'item_completed',
            item: { id: 'tool-3', type: 'webSearch', status: 'completed' },
          },
        },
      },
      {
        type: 'exec-command',
        phase: 'started',
        callId: 'cmd-1',
        command: 'pnpm test',
        cwd: '/repo',
        raw: {
          msg: {
            type: 'exec_command_begin',
            call_id: 'cmd-1',
            command: 'pnpm test',
            cwd: '/repo',
          },
        },
      },
      {
        type: 'exec-command-output-delta',
        callId: 'cmd-1',
        stream: 'stdout',
        delta: 'SGk=',
      },
      {
        type: 'exec-command',
        phase: 'completed',
        callId: 'cmd-1',
        command: 'pnpm test',
        cwd: undefined,
        output: 'ok',
        stderr: undefined,
        exitCode: 0,
        success: true,
        raw: {
          msg: {
            type: 'exec_command_end',
            call_id: 'cmd-1',
            command: 'pnpm test',
            aggregated_output: 'ok',
            exit_code: 0,
            success: true,
          },
        },
      },
      {
        type: 'terminal-interaction',
        callId: 'cmd-1',
        processId: '42',
        stdin: 'y',
        raw: { itemId: 'cmd-1', processId: 42, stdin: 'y' },
      },
      {
        type: 'terminal-interaction',
        callId: 'cmd-2',
        processId: '99',
        stdin: 'n',
        raw: {
          msg: {
            type: 'terminal_interaction',
            call_id: 'cmd-2',
            process_id: '99',
            stdin: 'n',
          },
        },
      },
      {
        type: 'patch-apply',
        phase: 'started',
        callId: 'patch-1',
        changes: { files: [] },
        raw: {
          msg: { type: 'patch_apply_begin', call_id: 'patch-1', changes: { files: [] } },
        },
      },
      { type: 'file-change-output-delta', itemId: 'patch-1', delta: 'applied' },
      {
        type: 'patch-apply',
        phase: 'completed',
        callId: 'patch-1',
        changes: undefined,
        stdout: 'done',
        stderr: undefined,
        success: true,
        raw: {
          msg: { type: 'patch_apply_end', call_id: 'patch-1', stdout: 'done', success: true },
        },
      },
      { type: 'diff-updated', diff: 'diff --git a/b b/b' },
      { type: 'turn-completed', status: 'interrupted' },
      { type: 'turn-completed', status: 'completed' },
      { type: 'thread-compacted' },
      { type: 'unknown', method: 'custom/event', params: { value: true } },
      { type: 'unknown', method: 'thread/started', params: { thread: {} } },
    ]);
  });

  it('routes registered server requests and defaults unknown request methods', () => {
    const transport = new FakeTransport();
    const client = new CodexAppServerClient(transport);
    client.onRequest('item/commandExecution/requestApproval', (params, requestId) => ({
      params,
      requestId,
    }));

    expect(
      transport.requestHandler?.('item/commandExecution/requestApproval', { itemId: 'cmd-1' }, 7)
    ).toEqual({ params: { itemId: 'cmd-1' }, requestId: 7 });
    expect(transport.requestHandler?.('unknown/request', {}, 8)).toEqual({});
  });

  it('returns an empty loaded-thread list for malformed app-server responses', async () => {
    const transport = new FakeTransport();
    const client = new CodexAppServerClient(transport);

    transport.setResponse('thread/loaded/list', null);
    await expect(client.listLoadedThreads()).resolves.toEqual([]);

    transport.setResponse('thread/loaded/list', { data: 'thread-1' });
    await expect(client.listLoadedThreads()).resolves.toEqual([]);
  });

  it('forwards app-server exit events', () => {
    const transport = new FakeTransport();
    const client = new CodexAppServerClient(transport);
    const onExit = vi.fn();

    client.onExit(onExit);
    transport.exitHandler?.(new Error('server exited'));

    expect(onExit).toHaveBeenCalledWith(expect.objectContaining({ message: 'server exited' }));
  });
});
