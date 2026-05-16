/**
 * Unit tests for the `task.*` MCP tools.
 *
 * The tools are thin adapters over operation functions and the PTY registry.
 * Runtime deps are loaded lazily inside `task-tools.ts` (so simply
 * constructing an `McpServer` doesn't pull in Electron / the DB), which
 * means we test by injecting a deps object via `_setTaskDeps()` rather than
 * `vi.mock()`-ing the underlying modules. This also keeps the test fast and
 * keeps the deferred-import indirection honest.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ok, type Result } from '@shared/result';
import type { CreateTaskParams, Task } from '@shared/tasks';
import { _resetTaskDeps, _setTaskDeps, registerTaskTools } from './task-tools';

// ── Test harness ────────────────────────────────────────────────────────────
// We don't need a real `McpServer` — we capture the `(name, config, handler)`
// triples passed to `registerTool` into a map, then drive each handler
// directly. This keeps the tests fast and SDK-version-agnostic.

type CapturedHandler = (args: Record<string, unknown>) => Promise<unknown> | unknown;

interface TestServer extends Pick<McpServer, 'registerTool'> {
  handlers: Map<string, CapturedHandler>;
  configs: Map<string, { title?: string; description?: string; inputSchema?: unknown }>;
}

function makeTestServer(): TestServer {
  const handlers = new Map<string, CapturedHandler>();
  const configs = new Map<
    string,
    { title?: string; description?: string; inputSchema?: unknown }
  >();
  const server: TestServer = {
    handlers,
    configs,
    registerTool: ((name: string, config: unknown, handler: CapturedHandler) => {
      handlers.set(name, handler);
      configs.set(name, config as { title?: string; description?: string; inputSchema?: unknown });
      return { remove: () => undefined } as never;
    }) as McpServer['registerTool'],
  };
  return server;
}

function makeTask(overrides: Partial<Task> = {}): Task {
  const base: Task = {
    id: 'task-1',
    projectId: 'proj-1',
    name: 'My task',
    status: 'in_progress',
    sourceBranch: { type: 'local', branch: 'main' },
    taskBranch: 'feat/my-task',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    statusChangedAt: '2026-01-01T00:00:00.000Z',
    isPinned: false,
    prs: [],
    conversations: {},
    workspaceId: 'ws-1',
  };
  return { ...base, ...overrides };
}

function parseReply(reply: unknown): { isError: boolean; payload: unknown } {
  const r = reply as {
    isError?: boolean;
    content: Array<{ type: 'text'; text: string }>;
  };
  return {
    isError: r.isError === true,
    payload: JSON.parse(r.content[0].text) as unknown,
  };
}

// ── Mock deps factory ──────────────────────────────────────────────────────

interface MockDeps {
  createTask: ReturnType<typeof vi.fn>;
  getTasks: ReturnType<typeof vi.fn>;
  deleteTask: ReturnType<typeof vi.fn>;
  archiveTask: ReturnType<typeof vi.fn>;
  restoreTask: ReturnType<typeof vi.fn>;
  renameTask: ReturnType<typeof vi.fn>;
  updateTaskStatus: ReturnType<typeof vi.fn>;
  updateLinkedIssue: ReturnType<typeof vi.fn>;
  setTaskPinned: ReturnType<typeof vi.fn>;
  ptyGet: ReturnType<typeof vi.fn>;
  ptyPeek: ReturnType<typeof vi.fn>;
  ptyList: ReturnType<typeof vi.fn>;
  wsGet: ReturnType<typeof vi.fn>;
  appOpenIn: ReturnType<typeof vi.fn>;
}

function makeMockDeps(): MockDeps {
  return {
    createTask: vi.fn(),
    getTasks: vi.fn().mockResolvedValue([]),
    deleteTask: vi.fn().mockResolvedValue(undefined),
    archiveTask: vi.fn().mockResolvedValue(undefined),
    restoreTask: vi.fn().mockResolvedValue(undefined),
    renameTask: vi.fn(),
    updateTaskStatus: vi.fn().mockResolvedValue(undefined),
    updateLinkedIssue: vi.fn().mockResolvedValue(undefined),
    setTaskPinned: vi.fn().mockResolvedValue(undefined),
    ptyGet: vi.fn(),
    ptyPeek: vi.fn().mockReturnValue(''),
    ptyList: vi.fn().mockReturnValue([]),
    wsGet: vi.fn(),
    appOpenIn: vi.fn().mockResolvedValue(undefined),
  };
}

function installMockDeps(m: MockDeps): void {
  // Build a structurally-compatible TaskDeps from our raw mocks. We cast
  // through `unknown` so we don't have to perfectly mirror every Result
  // discriminant in the test mocks — the tools only ever look at
  // `result.success` and pass the rest through `fromResult`.
  _setTaskDeps({
    createTask: m.createTask,
    getTasks: m.getTasks,
    deleteTask: m.deleteTask,
    archiveTask: m.archiveTask,
    restoreTask: m.restoreTask,
    renameTask: m.renameTask,
    updateTaskStatus: m.updateTaskStatus,
    updateLinkedIssue: m.updateLinkedIssue,
    setTaskPinned: m.setTaskPinned,
    ptySessionRegistry: {
      get: m.ptyGet,
      peek: m.ptyPeek,
      listActiveSessions: m.ptyList,
    },
    workspaceRegistry: {
      get: m.wsGet,
    },
    appService: {
      openIn: m.appOpenIn,
    },
  } as unknown as Parameters<typeof _setTaskDeps>[0]);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('task-tools', () => {
  let server: TestServer;
  let deps: MockDeps;

  beforeEach(() => {
    server = makeTestServer();
    registerTaskTools(server as unknown as McpServer);
    deps = makeMockDeps();
    installMockDeps(deps);
  });

  afterEach(() => {
    _resetTaskDeps();
    vi.clearAllMocks();
  });

  it('registers the expected tool catalogue under task.* names', () => {
    expect([...server.handlers.keys()].sort()).toEqual([
      'task.archive',
      'task.create',
      'task.delete',
      'task.get',
      'task.getOutput',
      'task.list',
      'task.listSessions',
      'task.openInIDE',
      'task.sendInput',
      'task.unarchive',
      'task.update',
    ]);
  });

  describe('task.create', () => {
    it('happy path → calls createTask with the new-branch strategy and returns the task', async () => {
      const task = makeTask();
      deps.createTask.mockResolvedValue(ok({ task }));

      const handler = server.handlers.get('task.create')!;
      const reply = await handler({
        projectId: 'proj-1',
        name: 'My task',
      });

      expect(deps.createTask).toHaveBeenCalledTimes(1);
      const callArgs = deps.createTask.mock.calls[0]![0] as CreateTaskParams;
      expect(callArgs.projectId).toBe('proj-1');
      expect(callArgs.name).toBe('My task');
      expect(callArgs.strategy).toEqual({ kind: 'new-branch', taskBranch: 'My task' });
      expect(callArgs.sourceBranch).toEqual({ type: 'local', branch: 'main' });

      const parsed = parseReply(reply);
      expect(parsed.isError).toBe(false);
      expect(parsed.payload).toEqual({ task });
    });

    it('rejects from-pull-request strategy with STRATEGY_NOT_SUPPORTED', async () => {
      const handler = server.handlers.get('task.create')!;
      const reply = await handler({
        projectId: 'proj-1',
        name: 'My task',
        strategy: 'from-pull-request',
      });
      const parsed = parseReply(reply) as {
        isError: boolean;
        payload: { code: string };
      };
      expect(parsed.isError).toBe(true);
      expect(parsed.payload.code).toBe('STRATEGY_NOT_SUPPORTED');
      expect(deps.createTask).not.toHaveBeenCalled();
    });
  });

  describe('task.delete', () => {
    it('without confirm returns CONFIRM_REQUIRED and does not call deleteTask', async () => {
      const handler = server.handlers.get('task.delete')!;
      const reply = await handler({ taskId: 'task-1' });
      const parsed = parseReply(reply) as {
        isError: boolean;
        payload: { code: string; details?: { taskId: string } };
      };
      expect(parsed.isError).toBe(true);
      expect(parsed.payload.code).toBe('CONFIRM_REQUIRED');
      expect(parsed.payload.details).toEqual({ taskId: 'task-1' });
      expect(deps.deleteTask).not.toHaveBeenCalled();
    });

    it('with confirm: true looks up the task and calls deleteTask(projectId, taskId)', async () => {
      deps.getTasks.mockResolvedValue([makeTask()]);

      const handler = server.handlers.get('task.delete')!;
      const reply = await handler({ taskId: 'task-1', confirm: true });

      expect(deps.deleteTask).toHaveBeenCalledWith('proj-1', 'task-1');
      const parsed = parseReply(reply);
      expect(parsed.isError).toBe(false);
      expect(parsed.payload).toEqual({ taskId: 'task-1', deleted: true });
    });

    it('with confirm: true on an unknown task returns NOT_FOUND', async () => {
      deps.getTasks.mockResolvedValue([]);

      const handler = server.handlers.get('task.delete')!;
      const reply = await handler({ taskId: 'missing', confirm: true });

      const parsed = parseReply(reply) as { isError: boolean; payload: { code: string } };
      expect(parsed.isError).toBe(true);
      expect(parsed.payload.code).toBe('NOT_FOUND');
      expect(deps.deleteTask).not.toHaveBeenCalled();
    });
  });

  describe('task.update', () => {
    it('patches a single field via the corresponding op (status)', async () => {
      const before = makeTask({ status: 'in_progress' });
      const after = makeTask({ status: 'review' });
      // First call resolves the projectId; second returns the post-update view.
      deps.getTasks.mockResolvedValueOnce([before]).mockResolvedValueOnce([after]);

      const handler = server.handlers.get('task.update')!;
      const reply = await handler({
        taskId: 'task-1',
        patch: { status: 'review' },
      });

      expect(deps.updateTaskStatus).toHaveBeenCalledWith('task-1', 'review');
      // No other op should fire when only status is patched.
      expect(deps.setTaskPinned).not.toHaveBeenCalled();
      expect(deps.renameTask).not.toHaveBeenCalled();

      const parsed = parseReply(reply) as { isError: boolean; payload: Task };
      expect(parsed.isError).toBe(false);
      expect(parsed.payload.status).toBe('review');
    });

    it('patches multiple fields and returns the refreshed task', async () => {
      const before = makeTask();
      const after = makeTask({ name: 'New name', isPinned: true });
      deps.getTasks.mockResolvedValueOnce([before]).mockResolvedValueOnce([after]);
      deps.renameTask.mockResolvedValue(ok({ warning: undefined }));

      const handler = server.handlers.get('task.update')!;
      const reply = await handler({
        taskId: 'task-1',
        patch: { name: 'New name', isPinned: true },
      });

      expect(deps.setTaskPinned).toHaveBeenCalledWith('task-1', true);
      expect(deps.renameTask).toHaveBeenCalledWith('proj-1', 'task-1', 'New name');
      const parsed = parseReply(reply) as { isError: boolean; payload: Task };
      expect(parsed.isError).toBe(false);
      expect(parsed.payload.name).toBe('New name');
      expect(parsed.payload.isPinned).toBe(true);
    });

    it('returns NOT_FOUND when the task does not exist', async () => {
      deps.getTasks.mockResolvedValue([]);
      const handler = server.handlers.get('task.update')!;
      const reply = await handler({ taskId: 'missing', patch: { status: 'done' } });
      const parsed = parseReply(reply) as { isError: boolean; payload: { code: string } };
      expect(parsed.isError).toBe(true);
      expect(parsed.payload.code).toBe('NOT_FOUND');
      expect(deps.updateTaskStatus).not.toHaveBeenCalled();
    });
  });

  describe('task.archive / task.unarchive', () => {
    it('task.archive calls archiveTask(projectId, taskId)', async () => {
      deps.getTasks.mockResolvedValue([makeTask()]);
      const handler = server.handlers.get('task.archive')!;
      const reply = await handler({ taskId: 'task-1' });
      expect(deps.archiveTask).toHaveBeenCalledWith('proj-1', 'task-1');
      expect(parseReply(reply).isError).toBe(false);
    });

    it('task.unarchive calls restoreTask(taskId)', async () => {
      const handler = server.handlers.get('task.unarchive')!;
      const reply = await handler({ taskId: 'task-1' });
      expect(deps.restoreTask).toHaveBeenCalledWith('task-1');
      expect(parseReply(reply).isError).toBe(false);
    });
  });

  describe('task.sendInput', () => {
    it('writes the data to the PTY session, optionally appending newline', async () => {
      const writeSpy = vi.fn();
      deps.ptyGet.mockReturnValue({ write: writeSpy });

      const handler = server.handlers.get('task.sendInput')!;
      const reply = await handler({
        taskId: 'task-1',
        sessionId: 'proj-1:task-1:leaf-1',
        data: 'echo hi',
        appendEnter: true,
      });

      expect(deps.ptyGet).toHaveBeenCalledWith('proj-1:task-1:leaf-1');
      expect(writeSpy).toHaveBeenCalledWith('echo hi\n');
      const parsed = parseReply(reply) as {
        isError: boolean;
        payload: { sessionId: string; bytesWritten: number };
      };
      expect(parsed.isError).toBe(false);
      expect(parsed.payload.bytesWritten).toBe('echo hi\n'.length);
    });

    it('returns NOT_FOUND when the session is unknown', async () => {
      deps.ptyGet.mockReturnValue(undefined);
      const handler = server.handlers.get('task.sendInput')!;
      const reply = await handler({
        taskId: 'task-1',
        sessionId: 'no-such',
        data: 'x',
      });
      const parsed = parseReply(reply) as { isError: boolean; payload: { code: string } };
      expect(parsed.isError).toBe(true);
      expect(parsed.payload.code).toBe('NOT_FOUND');
    });
  });

  describe('task.getOutput', () => {
    it('returns the ring buffer contents and a usable cursor', async () => {
      const buffer = 'hello world\n';
      deps.ptyPeek.mockReturnValue(buffer);
      // PTY is still alive → eof=false
      deps.ptyGet.mockReturnValue({});

      const handler = server.handlers.get('task.getOutput')!;
      const reply = await handler({
        taskId: 'task-1',
        sessionId: 'proj-1:task-1:leaf-1',
      });
      const parsed = parseReply(reply) as {
        isError: boolean;
        payload: { data: string; cursor: number; eof: boolean };
      };
      expect(parsed.isError).toBe(false);
      expect(parsed.payload.data).toBe(buffer);
      expect(parsed.payload.cursor).toBe(buffer.length);
      expect(parsed.payload.eof).toBe(false);
    });

    it('honours sinceCursor for incremental reads', async () => {
      const buffer = 'AAAABBBB';
      deps.ptyPeek.mockReturnValue(buffer);
      deps.ptyGet.mockReturnValue(undefined); // session exited → eof=true

      const handler = server.handlers.get('task.getOutput')!;
      const reply = await handler({
        taskId: 'task-1',
        sessionId: 'proj-1:task-1:leaf-1',
        sinceCursor: 4,
      });
      const parsed = parseReply(reply) as {
        isError: boolean;
        payload: { data: string; cursor: number; eof: boolean };
      };
      expect(parsed.payload.data).toBe('BBBB');
      expect(parsed.payload.cursor).toBe(8);
      expect(parsed.payload.eof).toBe(true);
    });
  });

  describe('task.listSessions', () => {
    it('filters active sessions to those whose sessionId scope matches the task id', async () => {
      deps.ptyList.mockReturnValue([
        { sessionId: 'proj-1:task-1:conv-a', pid: 1234, metadata: { title: 'Codex' } },
        { sessionId: 'proj-1:task-2:conv-b', pid: 5678, metadata: undefined },
        { sessionId: 'proj-1:task-1:term-c', pid: undefined, metadata: undefined },
      ]);

      const handler = server.handlers.get('task.listSessions')!;
      const reply = await handler({ taskId: 'task-1' });
      const parsed = parseReply(reply) as {
        isError: boolean;
        payload: Array<{ sessionId: string }>;
      };
      expect(parsed.isError).toBe(false);
      expect(parsed.payload.map((s) => s.sessionId)).toEqual([
        'proj-1:task-1:conv-a',
        'proj-1:task-1:term-c',
      ]);
    });
  });

  describe('task.openInIDE', () => {
    it('opens the workspace path in the requested editor', async () => {
      deps.getTasks.mockResolvedValue([makeTask({ workspaceId: 'ws-1' })]);
      deps.wsGet.mockReturnValue({ path: '/tmp/worktree' });

      const handler = server.handlers.get('task.openInIDE')!;
      const reply = await handler({ taskId: 'task-1', editor: 'cursor' });

      expect(deps.appOpenIn).toHaveBeenCalledWith({ app: 'cursor', path: '/tmp/worktree' });
      const parsed = parseReply(reply);
      expect(parsed.isError).toBe(false);
    });

    it('returns NOT_PROVISIONED when the task has no workspaceId', async () => {
      deps.getTasks.mockResolvedValue([makeTask({ workspaceId: undefined })]);
      const handler = server.handlers.get('task.openInIDE')!;
      const reply = await handler({ taskId: 'task-1', editor: 'cursor' });
      const parsed = parseReply(reply) as { isError: boolean; payload: { code: string } };
      expect(parsed.isError).toBe(true);
      expect(parsed.payload.code).toBe('NOT_PROVISIONED');
      expect(deps.appOpenIn).not.toHaveBeenCalled();
    });
  });

  describe('handler error normalisation', () => {
    it('catches thrown errors and surfaces them as UNHANDLED', async () => {
      deps.getTasks.mockRejectedValue(new Error('db unavailable'));
      const handler = server.handlers.get('task.list')!;
      const reply = await handler({ projectId: 'proj-1' });
      const parsed = parseReply(reply) as {
        isError: boolean;
        payload: { code: string; message: string };
      };
      expect(parsed.isError).toBe(true);
      expect(parsed.payload.code).toBe('UNHANDLED');
      expect(parsed.payload.message).toContain('db unavailable');
    });

    it('passes Result-Err shapes through fromResult preserving the error type', async () => {
      const errResult: Result<{ task: Task }, { type: 'project-not-found' }> = {
        success: false,
        error: { type: 'project-not-found' },
      };
      deps.createTask.mockResolvedValue(errResult);

      const handler = server.handlers.get('task.create')!;
      const reply = await handler({ projectId: 'missing', name: 'x' });
      const parsed = parseReply(reply) as { isError: boolean; payload: { code: string } };
      expect(parsed.isError).toBe(true);
      expect(parsed.payload.code).toBe('project-not-found');
    });
  });
});
