import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  private readonly handlers = new Map<string, (params: unknown) => Promise<unknown> | unknown>();

  constructor() {
    super();
    this.stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        for (const line of chunk.toString().split('\n')) {
          if (!line.trim()) continue;
          const message = JSON.parse(line) as JsonMessage;
          if (typeof message.method === 'string') {
            const method = message.method;
            this.clientRequests.push(message);
            void Promise.resolve()
              .then(() => this.handlers.get(method)?.(message.params) ?? {})
              .then((response) => {
                this.writeStdout({ id: message.id, result: response });
              })
              .catch((error) => {
                this.writeStdout({
                  id: message.id,
                  error: { message: error instanceof Error ? error.message : String(error) },
                });
              });
          } else {
            this.serverResponses.push(message);
          }
        }
        callback();
      },
    });
  }

  handle(method: string, handler: (params: unknown) => Promise<unknown> | unknown): void {
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
let previousCodexHome: string | undefined;

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual('node:child_process');
  return {
    ...actual,
    execFile: vi.fn(
      (
        _command: string,
        _args: string[],
        optionsOrCallback:
          | { cwd?: string; timeout?: number }
          | ((error: Error | null, stdout: string, stderr: string) => void),
        callback?: (error: Error | null, stdout: string, stderr: string) => void
      ) => {
        const done = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
        if (!done) throw new Error('execFile callback missing');
        done(null, 'codex 0.128.0', '');
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
  fakeChild.handle('skills/list', () => ({ data: [] }));
  fakeChild.handle('model/list', () => ({
    data: [
      {
        id: 'gpt-5',
        displayName: 'GPT-5',
        description: 'Default model',
        isDefault: true,
      },
      {
        id: 'gpt-3.5-turbo',
        displayName: 'GPT-3.5 Turbo',
      },
    ],
  }));
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
    previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = path.join(os.tmpdir(), 'emdash-empty-codex-home');
    setupFakeChild();
  });

  afterEach(() => {
    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }
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

  it('maps Paseo-style app-server progress notifications into timeline events', async () => {
    const events: ChatProviderRuntimeEvent[] = [];
    await createSession(events);

    fakeChild.notify('turn/started', { threadId: 'thread-1', turn: { id: 'turn-1' } });
    fakeChild.notify('turn/plan/updated', {
      plan: [
        { step: 'Inspect Paseo', status: 'completed' },
        { step: 'Port protocol events', status: 'in_progress' },
      ],
    });
    fakeChild.notify('turn/diff/updated', { diff: 'diff --git a/file.ts b/file.ts' });
    fakeChild.notify('thread/tokenUsage/updated', { tokenUsage: { totalTokens: 42 } });
    fakeChild.notify('codex/event/exec_command_begin', {
      msg: { type: 'exec_command_begin', call_id: 'cmd-1', command: 'pnpm test', cwd: '/repo' },
    });
    fakeChild.notify('codex/event/exec_command_output_delta', {
      msg: { type: 'exec_command_output_delta', call_id: 'cmd-1', chunk: 'bGluZSAxCg==' },
    });
    fakeChild.notify('codex/event/exec_command_end', {
      msg: { type: 'exec_command_end', call_id: 'cmd-1', success: true },
    });
    fakeChild.notify('item/completed', {
      item: { id: 'cmd-1', type: 'commandExecution', status: 'completed' },
    });
    fakeChild.notify('item/commandExecution/terminalInteraction', {
      itemId: 'cmd-1',
      processId: 7,
      stdin: 'q',
    });
    fakeChild.notify('item/fileChange/outputDelta', {
      itemId: 'patch-1',
      delta: 'patched output',
    });
    fakeChild.notify('item/completed', {
      item: { id: 'patch-1', type: 'fileChange', status: 'completed', title: 'Patch' },
    });
    fakeChild.notify('codex/event/exec_command_begin', {
      msg: { type: 'exec_command_begin', call_id: 'cmd-cancelled', command: 'sleep 10' },
    });
    fakeChild.notify('codex/event/turn_aborted', {
      msg: { type: 'turn_aborted', reason: 'cancelled' },
    });

    await vi.waitFor(() => {
      expect(events).toContainEqual({ type: 'status', status: 'idle' });
    });
    expect(events).toContainEqual({
      type: 'timeline',
      item: {
        id: 'plan:turn-1',
        kind: 'tool_call',
        payload: {
          toolName: 'plan',
          status: 'running',
          output: '- [completed] Inspect Paseo\n- [in_progress] Port protocol events',
          input: {
            plan: [
              { step: 'Inspect Paseo', status: 'completed' },
              { step: 'Port protocol events', status: 'in_progress' },
            ],
          },
        },
      },
      upsert: true,
    });
    expect(events).toContainEqual({
      type: 'timeline',
      item: {
        id: 'plan:turn-1',
        kind: 'tool_call',
        payload: {
          toolName: 'plan',
          status: 'cancelled',
          output: '- [completed] Inspect Paseo\n- [in_progress] Port protocol events',
          input: {
            plan: [
              { step: 'Inspect Paseo', status: 'completed' },
              { step: 'Port protocol events', status: 'in_progress' },
            ],
          },
        },
      },
      upsert: true,
    });
    expect(events).toContainEqual({
      type: 'timeline',
      item: {
        id: 'diff:turn-1',
        kind: 'tool_call',
        payload: {
          toolName: 'diff',
          status: 'running',
          output: 'diff --git a/file.ts b/file.ts',
        },
      },
      upsert: true,
    });
    expect(events).toContainEqual({
      type: 'timeline',
      item: {
        id: 'diff:turn-1',
        kind: 'tool_call',
        payload: {
          toolName: 'diff',
          status: 'cancelled',
          output: 'diff --git a/file.ts b/file.ts',
          input: undefined,
        },
      },
      upsert: true,
    });
    expect(events).toContainEqual({
      type: 'timeline',
      item: expect.objectContaining({
        id: 'cmd-1',
        payload: expect.objectContaining({
          toolName: 'shell',
          status: 'completed',
          output: 'line 1\n',
          input: {
            command: 'pnpm test',
            cwd: '/repo',
          },
        }),
      }),
      upsert: true,
    });
    expect(events).toContainEqual({
      type: 'timeline',
      item: expect.objectContaining({
        id: 'cmd-cancelled',
        payload: expect.objectContaining({
          toolName: 'shell',
          status: 'cancelled',
        }),
      }),
      upsert: true,
    });
    expect(
      events.some(
        (event) =>
          event.type === 'timeline' &&
          event.item.id === 'cmd-1' &&
          event.item.kind === 'tool_call' &&
          event.item.payload.toolName === 'commandExecution'
      )
    ).toBe(false);
    expect(events).toContainEqual({
      type: 'timeline',
      item: expect.objectContaining({
        id: 'terminal:7',
        payload: expect.objectContaining({
          toolName: 'terminal',
          output: 'Input sent to terminal:\nq',
        }),
      }),
      upsert: true,
    });
    expect(events).toContainEqual({
      type: 'timeline',
      item: expect.objectContaining({
        id: 'patch-1',
        payload: expect.objectContaining({
          toolName: 'Patch',
          status: 'completed',
          output: 'patched output',
        }),
      }),
      upsert: true,
    });
  });

  it('maps fallback and failure branches for Paseo-style progress notifications', async () => {
    const events: ChatProviderRuntimeEvent[] = [];
    await createSession(events);

    fakeChild.notify('turn/plan/updated', { plan: [{ status: 'pending' }] });
    fakeChild.notify('codex/event/turn_diff', { msg: { type: 'turn_diff', diff: 'legacy diff' } });
    fakeChild.notify('codex/event/exec_command_output_delta', {
      msg: { type: 'exec_command_output_delta', call_id: 'plain-chunk', delta: 'done' },
    });
    fakeChild.notify('codex/event/exec_command_end', {
      msg: { type: 'exec_command_end', call_id: 'plain-chunk', success: true },
    });
    fakeChild.notify('codex/event/exec_command_end', {
      msg: { type: 'exec_command_end', call_id: 'mirror-filled', success: true },
    });
    fakeChild.notify('item/completed', {
      item: {
        id: 'mirror-filled',
        type: 'commandExecution',
        status: 'completed',
        command: ['pnpm', 'test'],
        cwd: '/repo',
        aggregatedOutput: 'mirror output',
        exitCode: 0,
      },
    });
    fakeChild.notify('codex/event/exec_command_begin', {
      msg: {
        type: 'exec_command_begin',
        call_id: 'begin-then-mirror',
        command: 'pnpm typecheck',
      },
    });
    fakeChild.notify('codex/event/exec_command_end', {
      msg: { type: 'exec_command_end', call_id: 'begin-then-mirror', success: true },
    });
    fakeChild.notify('item/completed', {
      item: {
        id: 'begin-then-mirror',
        type: 'commandExecution',
        status: 'completed',
        aggregatedOutput: 'typecheck ok',
      },
    });
    fakeChild.notify('codex/event/exec_command_end', {
      msg: {
        type: 'exec_command_end',
        call_id: 'exit-failed',
        command: 'pnpm test',
        exit_code: 1,
        stderr: 'failed',
      },
    });
    fakeChild.notify('codex/event/exec_command_end', {
      msg: {
        type: 'exec_command_end',
        command: 'pnpm lint',
        stderr: 'lint failed',
        success: false,
      },
    });
    fakeChild.notify('codex/event/terminal_interaction', {
      msg: { type: 'terminal_interaction' },
    });
    fakeChild.notify('codex/event/patch_apply_begin', {
      msg: { type: 'patch_apply_begin', call_id: 'patch-fail', changes: { path: 'a.ts' } },
    });
    fakeChild.notify('codex/event/patch_apply_end', {
      msg: {
        type: 'patch_apply_end',
        call_id: 'patch-fail',
        stderr: 'patch failed',
        success: false,
      },
    });
    fakeChild.notify('item/fileChange/outputDelta', {
      itemId: 'file-change-chunk',
      chunk: 'chunk output',
    });
    fakeChild.notify('item/completed', {
      item: { id: 'file-change-chunk', type: 'fileChange', status: 'completed' },
    });
    fakeChild.notify('item/agentMessage/delta', {
      itemId: 'assistant-uppercase',
      delta: 'hello',
    });
    fakeChild.notify('item/completed', {
      item: { id: 'assistant-uppercase', type: 'AgentMessage', status: 'completed' },
    });
    fakeChild.notify('item/completed', {
      item: { id: 'user-uppercase', type: 'UserMessage', status: 'completed' },
    });
    fakeChild.notify('turn/plan/updated', { plan: [{ step: 'will fail', status: 'in_progress' }] });
    fakeChild.notify('turn/diff/updated', { diff: 'failed diff' });
    fakeChild.notify('codex/event/exec_command_begin', {
      msg: { type: 'exec_command_begin', call_id: 'cmd-failed-running', command: 'pnpm fail' },
    });
    fakeChild.notify('turn/completed', {
      threadId: 'thread-1',
      turn: { status: 'failed', error: { message: 'turn failed' } },
    });

    await vi.waitFor(() => {
      expect(events).toContainEqual({
        type: 'timeline',
        item: expect.objectContaining({
          id: expect.stringMatching(/^exec:/),
          payload: expect.objectContaining({
            toolName: 'shell',
            status: 'failed',
            output: undefined,
            error: 'lint failed',
          }),
        }),
        upsert: true,
      });
    });
    expect(events).toContainEqual({
      type: 'timeline',
      item: expect.objectContaining({
        id: 'plain-chunk',
        payload: expect.objectContaining({
          toolName: 'shell',
          status: 'completed',
          output: 'done',
        }),
      }),
      upsert: true,
    });
    expect(events).toContainEqual({
      type: 'timeline',
      item: expect.objectContaining({
        id: 'begin-then-mirror',
        payload: expect.objectContaining({
          toolName: 'shell',
          status: 'completed',
          input: {
            command: 'pnpm typecheck',
            cwd: undefined,
          },
          output: 'typecheck ok',
        }),
      }),
      upsert: true,
    });
    expect(events).toContainEqual({
      type: 'timeline',
      item: expect.objectContaining({
        id: 'mirror-filled',
        payload: expect.objectContaining({
          toolName: 'shell',
          status: 'completed',
          input: {
            command: 'pnpm test',
            cwd: '/repo',
          },
          output: 'mirror output',
        }),
      }),
      upsert: true,
    });
    expect(events).toContainEqual({
      type: 'timeline',
      item: expect.objectContaining({
        id: 'exit-failed',
        payload: expect.objectContaining({
          toolName: 'shell',
          status: 'failed',
          error: 'failed',
        }),
      }),
      upsert: true,
    });
    expect(events).toContainEqual({
      type: 'timeline',
      item: expect.objectContaining({
        id: 'plan:thread-1',
        payload: expect.objectContaining({ output: 'Plan updated.' }),
      }),
      upsert: true,
    });
    expect(events).toContainEqual({
      type: 'timeline',
      item: expect.objectContaining({
        id: 'diff:thread-1',
        payload: expect.objectContaining({ output: 'legacy diff' }),
      }),
      upsert: true,
    });
    expect(events).toContainEqual({
      type: 'timeline',
      item: expect.objectContaining({
        id: expect.stringMatching(/^terminal:terminal:/),
        payload: expect.objectContaining({
          toolName: 'terminal',
          output: undefined,
        }),
      }),
      upsert: true,
    });
    expect(events).toContainEqual({
      type: 'timeline',
      item: expect.objectContaining({
        id: 'patch-fail',
        payload: expect.objectContaining({
          toolName: 'fileChange',
          status: 'failed',
          error: 'patch failed',
        }),
      }),
      upsert: true,
    });
    expect(events).toContainEqual({
      type: 'timeline',
      item: expect.objectContaining({
        id: 'file-change-chunk',
        payload: expect.objectContaining({
          toolName: 'fileChange',
          output: 'chunk output',
        }),
      }),
      upsert: true,
    });
    expect(
      events.some(
        (event) =>
          event.type === 'timeline' &&
          event.item.id === 'assistant-uppercase' &&
          event.item.kind === 'tool_call'
      )
    ).toBe(false);
    expect(
      events.some(
        (event) =>
          event.type === 'timeline' &&
          event.item.id === 'user-uppercase' &&
          event.item.kind === 'tool_call'
      )
    ).toBe(false);
    expect(events).toContainEqual({
      type: 'timeline',
      item: expect.objectContaining({
        id: 'plan:thread-1',
        payload: expect.objectContaining({
          status: 'failed',
          output: '- [in_progress] will fail',
        }),
      }),
      upsert: true,
    });
    expect(events).toContainEqual({
      type: 'timeline',
      item: expect.objectContaining({
        id: 'diff:thread-1',
        payload: expect.objectContaining({
          status: 'failed',
          output: 'failed diff',
        }),
      }),
      upsert: true,
    });
    expect(events).toContainEqual({
      type: 'timeline',
      item: expect.objectContaining({
        id: 'cmd-failed-running',
        payload: expect.objectContaining({
          toolName: 'shell',
          status: 'failed',
          error: 'turn failed',
        }),
      }),
      upsert: true,
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

  it('cancels pending app-server permission requests when a turn aborts', async () => {
    const events: ChatProviderRuntimeEvent[] = [];
    await createSession(events);

    fakeChild.request(100, 'item/commandExecution/requestApproval', {
      itemId: 'cmd-1',
      command: 'pnpm test',
    });
    await vi.waitFor(() => {
      expect(permissionRequest(events, 'permission-cmd-1')).toBeDefined();
    });

    fakeChild.notify('codex/event/turn_aborted', {
      msg: { type: 'turn_aborted', reason: 'cancelled' },
    });

    await vi.waitFor(() => {
      expect(fakeChild.serverResponses).toContainEqual({
        id: 100,
        error: { message: 'Permission request permission-cmd-1 was cancelled: Turn completed' },
      });
    });
    expect(events).toContainEqual({ type: 'status', status: 'idle' });
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

  it('does not enter pre-turn-start state while resolving prompt-like slash input', async () => {
    const skills = deferred<unknown>();
    fakeChild.handle('skills/list', () => skills.promise);
    const { adapter, session } = await createSession([]);

    const send = adapter.sendMessage(session, { text: '/review edge cases' });

    await expect(adapter.cancel(session)).resolves.toBeUndefined();
    expect(fakeChild.clientRequests.some((request) => request.method === 'turn/interrupt')).toBe(
      false
    );
    expect(fakeChild.clientRequests.some((request) => request.method === 'turn/start')).toBe(false);

    skills.resolve({ data: [] });
    await expect(send).rejects.toThrow('Message send was cancelled');
    expect(fakeChild.clientRequests.some((request) => request.method === 'turn/start')).toBe(false);
  });

  it('keeps overlapping prompt-like send preparations independently cancellable', async () => {
    const firstSkills = deferred<unknown>();
    const secondSkills = deferred<unknown>();
    let callCount = 0;
    fakeChild.handle('skills/list', () => {
      callCount += 1;
      return callCount === 1 ? firstSkills.promise : secondSkills.promise;
    });
    const { adapter, session } = await createSession([]);

    const firstSend = adapter.sendMessage(session, { text: '/review first' });
    await vi.waitFor(() => expect(callCount).toBe(1));
    await adapter.cancel(session);
    const secondSend = adapter.sendMessage(session, { text: '/review second' });
    await vi.waitFor(() => expect(callCount).toBe(2));

    firstSkills.resolve({ data: [] });
    await expect(firstSend).rejects.toThrow('Message send was cancelled');

    await adapter.cancel(session);
    secondSkills.resolve({ data: [] });
    await expect(secondSend).rejects.toThrow('Message send was cancelled');
    expect(fakeChild.clientRequests.some((request) => request.method === 'turn/start')).toBe(false);
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

  it('lists app-server skills and sends selected skills using Codex skill input', async () => {
    fakeChild.handle('skills/list', () => ({
      data: [
        {
          skills: [
            {
              name: 'review',
              description: 'Review the current change',
              path: '/tmp/project/.codex/skills/review',
            },
            {
              name: 'disabled-review',
              description: 'Disabled review',
              enabled: false,
              path: '/tmp/project/.codex/skills/disabled-review',
            },
          ],
        },
      ],
    }));
    const codexHome = await mkdtemp(path.join(os.tmpdir(), 'emdash-codex-home-'));
    process.env.CODEX_HOME = codexHome;
    await mkdir(path.join(codexHome, 'skills', 'disabled-review'), { recursive: true });
    await writeFile(
      path.join(codexHome, 'skills', 'disabled-review', 'SKILL.md'),
      ['---', 'name: disabled-review', 'description: Disabled review', '---', 'Disabled.'].join(
        '\n'
      )
    );
    const { adapter, session } = await createSession([]);

    await expect(adapter.listCommands(session)).resolves.toEqual([
      {
        name: 'compact',
        description: 'Compact Codex context',
        argumentHint: '',
        execution: 'out-of-band',
      },
      {
        name: 'goal',
        description: 'Set, pause, resume, or clear the Codex goal',
        argumentHint: '[<objective>|pause|resume|clear]',
        execution: 'out-of-band',
      },
      {
        name: 'review',
        description: 'Review the current change',
        argumentHint: '',
        execution: 'prompt',
      },
    ]);

    await adapter.sendMessage(session, { text: '/review "edge cases"' });

    expect(
      fakeChild.clientRequests.find((request) => request.method === 'turn/start')
    ).toMatchObject({
      params: {
        input: [
          { type: 'skill', name: 'review', path: '/tmp/project/.codex/skills/review' },
          { type: 'text', text: '$review "edge cases"', text_elements: [] },
        ],
      },
    });

    await adapter.sendMessage(session, { text: '/disabled-review "edge cases"' });
    expect(
      fakeChild.clientRequests.filter((request) => request.method === 'turn/start')[1]
    ).toMatchObject({
      params: {
        input: [{ type: 'text', text: '/disabled-review "edge cases"', text_elements: [] }],
      },
    });

    fakeChild.handle('skills/list', () => {
      throw new Error('skills unavailable');
    });
    await adapter.sendMessage(session, { text: '/review retry' });
    expect(
      fakeChild.clientRequests.filter((request) => request.method === 'turn/start')[2]
    ).toMatchObject({
      params: {
        input: [
          { type: 'skill', name: 'review', path: '/tmp/project/.codex/skills/review' },
          { type: 'text', text: '$review retry', text_elements: [] },
        ],
      },
    });
  });

  it('exposes model and fast controls and applies selected values to future turns', async () => {
    const { adapter, session } = await createSession([]);

    await expect(adapter.getControls(session)).resolves.toMatchObject({
      selectedModelId: 'gpt-5',
      models: [
        { id: 'gpt-5', label: 'GPT-5', isDefault: true },
        { id: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
      ],
      features: [
        {
          id: 'fast_mode',
          label: 'Fast',
          type: 'toggle',
          value: false,
        },
      ],
    });

    await adapter.setFeature(session, 'fast_mode', true);
    await adapter.setModel(session, 'gpt-5');
    await adapter.sendMessage(session, { text: 'hello' });

    expect(
      fakeChild.clientRequests.find((request) => request.method === 'turn/start')
    ).toMatchObject({
      params: {
        model: 'gpt-5',
        serviceTier: 'fast',
      },
    });
  });

  it('clears unavailable fast mode when switching to an unsupported model', async () => {
    const { adapter, session } = await createSession([]);

    await adapter.setFeature(session, 'fast_mode', true);
    await expect(adapter.setModel(session, 'gpt-3.5-turbo')).resolves.toMatchObject({
      selectedModelId: 'gpt-3.5-turbo',
      features: [],
    });
    await adapter.sendMessage(session, { text: 'hello' });

    const turnStart = fakeChild.clientRequests.find((request) => request.method === 'turn/start');
    expect(turnStart).toBeDefined();
    expect(turnStart).toMatchObject({
      params: {
        model: 'gpt-3.5-turbo',
      },
    });
    expect((turnStart!.params as { serviceTier?: unknown }).serviceTier).toBeUndefined();
  });

  it('lists fallback filesystem skills when app-server skills are unavailable', async () => {
    fakeChild.handle('skills/list', () => {
      throw new Error('skills unavailable');
    });
    const codexHome = await mkdtemp(path.join(os.tmpdir(), 'emdash-codex-home-'));
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;
    try {
      await mkdir(path.join(codexHome, 'skills', 'audit'), { recursive: true });
      await writeFile(
        path.join(codexHome, 'skills', 'audit', 'SKILL.md'),
        [
          '---',
          'name: audit',
          'description: Audit the implementation',
          '---',
          'Run an audit.',
        ].join('\n')
      );
      await mkdir(path.join(codexHome, 'skills', 'disabled-audit'), { recursive: true });
      await writeFile(
        path.join(codexHome, 'skills', 'disabled-audit', 'SKILL.md'),
        [
          '---',
          'name: disabled-audit',
          'description: Disabled audit',
          'enabled: false',
          '---',
          'Do not run.',
        ].join('\n')
      );
      const { adapter, session } = await createSession([]);

      const commands = await adapter.listCommands(session);
      expect(commands).toContainEqual({
        name: 'audit',
        description: 'Audit the implementation',
        argumentHint: '',
        execution: 'prompt',
      });
      expect(commands).not.toContainEqual(
        expect.objectContaining({
          name: 'disabled-audit',
        })
      );

      await adapter.sendMessage(session, { text: '/audit now' });
      expect(
        fakeChild.clientRequests.find((request) => request.method === 'turn/start')
      ).toMatchObject({
        params: {
          input: [{ type: 'text', text: '$audit now', text_elements: [] }],
        },
      });
    } finally {
      if (previousCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = previousCodexHome;
      }
    }
  });

  it('does not use filesystem skills when app-server returns empty skill metadata', async () => {
    fakeChild.handle('skills/list', () => ({ data: [{ skills: [] }] }));
    const codexHome = await mkdtemp(path.join(os.tmpdir(), 'emdash-codex-home-'));
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;
    try {
      await mkdir(path.join(codexHome, 'skills', 'audit'), { recursive: true });
      await writeFile(
        path.join(codexHome, 'skills', 'audit', 'SKILL.md'),
        [
          '---',
          'name: audit',
          'description: Audit the implementation',
          '---',
          'Run an audit.',
        ].join('\n')
      );
      const { adapter, session } = await createSession([]);

      const commands = await adapter.listCommands(session);
      expect(commands).not.toContainEqual(expect.objectContaining({ name: 'audit' }));

      await adapter.sendMessage(session, { text: '/audit now' });
      expect(
        fakeChild.clientRequests.find((request) => request.method === 'turn/start')
      ).toMatchObject({
        params: {
          input: [{ type: 'text', text: '/audit now', text_elements: [] }],
        },
      });
    } finally {
      if (previousCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = previousCodexHome;
      }
    }
  });

  it('lists and expands Codex custom prompt slash commands', async () => {
    const codexHome = await mkdtemp(path.join(os.tmpdir(), 'emdash-codex-home-'));
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = codexHome;
    try {
      await mkdir(path.join(codexHome, 'prompts'), { recursive: true });
      await writeFile(
        path.join(codexHome, 'prompts', 'fix.md'),
        [
          '---',
          'description: Fix a defect',
          'argument-hint: <file>',
          '---',
          'Fix $1 with $name. Args: $ARGUMENTS. Dollar: $$',
        ].join('\n')
      );
      await writeFile(path.join(codexHome, 'prompts', 'empty.md'), '');
      const { adapter, session } = await createSession([]);

      await expect(adapter.listCommands(session)).resolves.toContainEqual({
        name: 'prompts:fix',
        description: 'Fix a defect',
        argumentHint: '<file>',
        execution: 'prompt',
      });

      await adapter.sendMessage(session, { text: '/prompts:fix src/app.ts name=tests' });
      expect(
        fakeChild.clientRequests.find((request) => request.method === 'turn/start')
      ).toMatchObject({
        params: {
          input: [
            {
              type: 'text',
              text: 'Fix src/app.ts with tests. Args: src/app.ts name=tests. Dollar: $',
              text_elements: [],
            },
          ],
        },
      });

      await adapter.sendMessage(session, { text: '/prompts:empty' });
      expect(
        fakeChild.clientRequests.filter((request) => request.method === 'turn/start')[1]
      ).toMatchObject({
        params: {
          input: [{ type: 'text', text: '', text_elements: [] }],
        },
      });
    } finally {
      if (previousCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = previousCodexHome;
      }
    }
  });

  it('falls back to normal prompt text for unknown prompt-like slash commands', async () => {
    const { adapter, session } = await createSession([]);

    await adapter.sendMessage(session, { text: '/prompts:missing hello' });
    await adapter.sendMessage(session, { text: '/prompts:..\\secret hello' });
    await adapter.sendMessage(session, { text: '/unknown hello' });

    const turnStarts = fakeChild.clientRequests.filter(
      (request) => request.method === 'turn/start'
    );
    expect(turnStarts).toHaveLength(3);
    expect(turnStarts[0]).toMatchObject({
      params: {
        input: [{ type: 'text', text: '/prompts:missing hello', text_elements: [] }],
      },
    });
    expect(turnStarts[1]).toMatchObject({
      params: {
        input: [{ type: 'text', text: '/prompts:..\\secret hello', text_elements: [] }],
      },
    });
    expect(turnStarts[2]).toMatchObject({
      params: {
        input: [{ type: 'text', text: '/unknown hello', text_elements: [] }],
      },
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
      {
        name: 'compact',
        description: 'Compact Codex context',
        argumentHint: '',
        execution: 'out-of-band',
      },
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
      {
        name: 'compact',
        description: 'Compact Codex context',
        argumentHint: '',
        execution: 'out-of-band',
      },
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
        {
          name: 'compact',
          description: 'Compact Codex context',
          argumentHint: '',
          execution: 'out-of-band',
        },
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
    fakeChild.notify('turn/plan/updated', {
      plan: [{ step: 'wait for server', status: 'in_progress' }],
    });
    fakeChild.notify('codex/event/exec_command_begin', {
      msg: { type: 'exec_command_begin', call_id: 'cmd-running', command: 'pnpm test' },
    });
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
    expect(events).toContainEqual({
      type: 'timeline',
      item: expect.objectContaining({
        id: 'plan:turn-1',
        payload: expect.objectContaining({
          toolName: 'plan',
          status: 'failed',
          output: '- [in_progress] wait for server',
        }),
      }),
      upsert: true,
    });
    expect(events).toContainEqual({
      type: 'timeline',
      item: expect.objectContaining({
        id: 'cmd-running',
        payload: expect.objectContaining({
          toolName: 'shell',
          status: 'failed',
          error: expect.stringContaining('fatal app-server error'),
        }),
      }),
      upsert: true,
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
