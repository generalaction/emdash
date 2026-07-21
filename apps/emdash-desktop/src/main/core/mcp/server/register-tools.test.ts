import { err, ok } from '@emdash/shared';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  archiveTask: vi.fn(),
  renameTask: vi.fn(),
  deleteTask: vi.fn(),
  getDeletePreflight: vi.fn(),
  createTaskFromPrompt: vi.fn(),
  ensureProjectOpen: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.0-test' },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  desc: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: { select: mocks.select },
}));

vi.mock('@main/db/schema', () => ({
  projects: {},
  tasks: {},
  workspaces: {},
}));

vi.mock('@main/core/agents/plugin-registry', () => ({
  listPlugins: () => [{ metadata: { id: 'claude' } }, { metadata: { id: 'codex' } }],
}));

vi.mock('@main/core/tasks/task-service', () => ({
  taskService: {
    archiveTask: mocks.archiveTask,
    renameTask: mocks.renameTask,
    deleteTask: mocks.deleteTask,
    getDeletePreflight: mocks.getDeletePreflight,
  },
}));

vi.mock('@main/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: mocks.logError },
}));

vi.mock('./create-task-from-prompt', () => ({
  createTaskFromPrompt: mocks.createTaskFromPrompt,
  ensureProjectOpen: mocks.ensureProjectOpen,
  validProviderIds: () => 'claude, codex',
}));

const { buildEmdashMcpServer } = await import('./register-tools');

/**
 * Minimal stand-in for drizzle's fluent select builder: every step returns
 * itself and awaiting it yields the queued rows, one queue entry per
 * `db.select()` call.
 */
function queueSelectResults(...results: unknown[][]): void {
  const queue = [...results];
  mocks.select.mockImplementation(() => {
    const rows = queue.shift() ?? [];
    const chain = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      then: (onFulfilled: (rows: unknown) => unknown, onRejected?: (error: unknown) => unknown) =>
        Promise.resolve(rows).then(onFulfilled, onRejected),
    };
    return chain;
  });
}

async function connectClient(): Promise<Client> {
  const server = buildEmdashMcpServer();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

type ToolResult = { isError?: boolean; content: { type: string; text: string }[] };

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>
): Promise<{ isError: boolean; text: string }> {
  const result = (await client.callTool({ name, arguments: args })) as ToolResult;
  return { isError: result.isError === true, text: result.content[0]?.text ?? '' };
}

beforeEach(() => {
  vi.clearAllMocks();
  queueSelectResults();
});

describe('tool registry', () => {
  it('exposes exactly the six emdash tools', async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'archive_task',
      'create_task',
      'delete_task',
      'list_projects',
      'list_tasks',
      'rename_task',
    ]);
  });

  it('marks the list tools read-only and only delete_task destructive', async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool.annotations]));
    expect(byName.get('list_projects')).toMatchObject({ readOnlyHint: true });
    expect(byName.get('list_tasks')).toMatchObject({ readOnlyHint: true });
    expect(byName.get('delete_task')).toMatchObject({ destructiveHint: true });
    for (const name of ['create_task', 'archive_task', 'rename_task']) {
      expect(byName.get(name)).toMatchObject({ destructiveHint: false });
    }
    for (const [, annotations] of byName) {
      expect(annotations).toMatchObject({ openWorldHint: false });
    }
  });
});

describe('error guarding', () => {
  it('hides internal error details from the client and logs them instead', async () => {
    mocks.select.mockImplementation(() => {
      throw new Error('SQLITE_BUSY: /Users/x/secret.db is locked');
    });
    const client = await connectClient();
    const result = await callTool(client, 'list_tasks', { projectId: 'p1' });
    expect(result.isError).toBe(true);
    expect(result.text).toBe('emdash hit an internal error while handling list_tasks');
    expect(result.text).not.toContain('SQLITE_BUSY');
    expect(mocks.logError).toHaveBeenCalledWith(
      'McpHttpServer: list_tasks failed',
      expect.objectContaining({ error: expect.stringContaining('SQLITE_BUSY') })
    );
  });
});

describe('list_projects', () => {
  it('returns the project rows', async () => {
    queueSelectResults([{ id: 'p1', name: 'emdash', path: '/repo' }]);
    const client = await connectClient();
    const result = await callTool(client, 'list_projects', {});
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text)).toEqual([{ id: 'p1', name: 'emdash', path: '/repo' }]);
  });
});

describe('list_tasks', () => {
  it('enriches tasks with branch and worktree path from their workspace', async () => {
    queueSelectResults(
      [
        {
          id: 't1',
          name: 'With workspace',
          status: 'running',
          updatedAt: 2,
          archivedAt: null,
          workspaceId: 'ws1',
        },
        {
          id: 't2',
          name: 'No workspace',
          status: 'archived',
          updatedAt: 1,
          archivedAt: 99,
          workspaceId: null,
        },
      ],
      [{ id: 'ws1', path: '/worktrees/t1', branchName: 'feat/t1' }]
    );
    const client = await connectClient();
    const result = await callTool(client, 'list_tasks', { projectId: 'p1' });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text)).toEqual([
      {
        id: 't1',
        name: 'With workspace',
        status: 'running',
        updatedAt: 2,
        isArchived: false,
        branchName: 'feat/t1',
        workspacePath: '/worktrees/t1',
      },
      {
        id: 't2',
        name: 'No workspace',
        status: 'archived',
        updatedAt: 1,
        isArchived: true,
        branchName: null,
        workspacePath: null,
      },
    ]);
  });
});

describe('create_task', () => {
  it('returns the creation result on success', async () => {
    mocks.createTaskFromPrompt.mockResolvedValue(ok({ taskId: 't1', branchName: 'b1' }));
    const client = await connectClient();
    const result = await callTool(client, 'create_task', { projectId: 'p1', prompt: 'go' });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text)).toEqual({ taskId: 't1', branchName: 'b1' });
  });

  it('surfaces validation errors as tool errors', async () => {
    mocks.createTaskFromPrompt.mockResolvedValue(err('Unknown provider "x"'));
    const client = await connectClient();
    const result = await callTool(client, 'create_task', {
      projectId: 'p1',
      prompt: 'go',
      provider: 'x',
    });
    expect(result.isError).toBe(true);
    expect(result.text).toBe('Unknown provider "x"');
  });
});

describe('archive_task', () => {
  it('rejects a task that is not in the project', async () => {
    queueSelectResults([]);
    const client = await connectClient();
    const result = await callTool(client, 'archive_task', { projectId: 'p1', taskId: 't1' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Task not found in project p1: t1');
    expect(mocks.archiveTask).not.toHaveBeenCalled();
  });

  it('opens the project before archiving so live sessions get torn down', async () => {
    queueSelectResults([{ id: 't1' }]);
    mocks.ensureProjectOpen.mockResolvedValue({});
    mocks.archiveTask.mockResolvedValue(undefined);
    const client = await connectClient();
    const result = await callTool(client, 'archive_task', { projectId: 'p1', taskId: 't1' });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text)).toEqual({ taskId: 't1', archived: true });
    expect(mocks.ensureProjectOpen).toHaveBeenCalledWith('p1');
    expect(mocks.archiveTask).toHaveBeenCalledWith('p1', 't1');
    const openOrder = mocks.ensureProjectOpen.mock.invocationCallOrder[0] ?? 0;
    const archiveOrder = mocks.archiveTask.mock.invocationCallOrder[0] ?? 0;
    expect(openOrder).toBeLessThan(archiveOrder);
  });

  it('archives but warns when the project cannot be opened', async () => {
    queueSelectResults([{ id: 't1' }]);
    mocks.ensureProjectOpen.mockResolvedValue(undefined);
    mocks.archiveTask.mockResolvedValue(undefined);
    const client = await connectClient();
    const result = await callTool(client, 'archive_task', { projectId: 'p1', taskId: 't1' });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text)).toEqual({
      taskId: 't1',
      archived: true,
      warning: expect.stringContaining('live agent sessions'),
    });
    expect(mocks.archiveTask).toHaveBeenCalledWith('p1', 't1');
  });
});

describe('rename_task', () => {
  it('rejects an empty name', async () => {
    const client = await connectClient();
    const result = await callTool(client, 'rename_task', {
      projectId: 'p1',
      taskId: 't1',
      name: '   ',
    });
    expect(result.isError).toBe(true);
    expect(result.text).toBe('name must not be empty');
    expect(mocks.renameTask).not.toHaveBeenCalled();
  });

  it('renames with the trimmed name', async () => {
    mocks.renameTask.mockResolvedValue(ok({ task: { name: 'New name' } }));
    const client = await connectClient();
    const result = await callTool(client, 'rename_task', {
      projectId: 'p1',
      taskId: 't1',
      name: '  New name  ',
    });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text)).toEqual({ taskId: 't1', name: 'New name' });
    expect(mocks.renameTask).toHaveBeenCalledWith('p1', 't1', 'New name');
  });

  it('reports a missing task as an error', async () => {
    mocks.renameTask.mockResolvedValue(err({ taskId: 't1' }));
    const client = await connectClient();
    const result = await callTool(client, 'rename_task', {
      projectId: 'p1',
      taskId: 't1',
      name: 'x',
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Task not found in project p1: t1');
  });
});

describe('delete_task', () => {
  it('rejects a task that is not in the project', async () => {
    queueSelectResults([]);
    const client = await connectClient();
    const result = await callTool(client, 'delete_task', { projectId: 'p1', taskId: 't1' });
    expect(result.isError).toBe(true);
    expect(mocks.deleteTask).not.toHaveBeenCalled();
  });

  it('fails closed when the project cannot be opened to verify the worktree', async () => {
    queueSelectResults([{ id: 't1' }]);
    mocks.ensureProjectOpen.mockResolvedValue(undefined);
    const client = await connectClient();
    const result = await callTool(client, 'delete_task', { projectId: 'p1', taskId: 't1' });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('could not be opened');
    expect(mocks.deleteTask).not.toHaveBeenCalled();
  });

  it('asks for confirmation instead of deleting when the worktree has uncommitted changes', async () => {
    queueSelectResults([{ id: 't1' }]);
    mocks.ensureProjectOpen.mockResolvedValue({});
    mocks.getDeletePreflight.mockResolvedValue({
      tasks: [{ taskId: 't1', hasUncommittedChanges: true }],
    });
    const client = await connectClient();
    const result = await callTool(client, 'delete_task', { projectId: 'p1', taskId: 't1' });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text)).toMatchObject({
      taskId: 't1',
      deleted: false,
      requiresConfirmation: true,
      instructions: expect.stringContaining('confirm: true'),
    });
    expect(mocks.deleteTask).not.toHaveBeenCalled();
  });

  it('deletes a dirty worktree once the user has confirmed', async () => {
    queueSelectResults([{ id: 't1' }]);
    mocks.ensureProjectOpen.mockResolvedValue({});
    mocks.getDeletePreflight.mockResolvedValue({
      tasks: [{ taskId: 't1', hasUncommittedChanges: true }],
    });
    mocks.deleteTask.mockResolvedValue(undefined);
    const client = await connectClient();
    const result = await callTool(client, 'delete_task', {
      projectId: 'p1',
      taskId: 't1',
      confirm: true,
    });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text)).toEqual({ taskId: 't1', deleted: true, branchKept: true });
    expect(mocks.deleteTask).toHaveBeenCalledWith('p1', 't1', {
      deleteWorktree: true,
      deleteBranch: false,
    });
  });

  it('deletes the worktree but keeps the branch when the worktree is clean', async () => {
    queueSelectResults([{ id: 't1' }]);
    mocks.ensureProjectOpen.mockResolvedValue({});
    mocks.getDeletePreflight.mockResolvedValue({
      tasks: [{ taskId: 't1', hasUncommittedChanges: false }],
    });
    mocks.deleteTask.mockResolvedValue(undefined);
    const client = await connectClient();
    const result = await callTool(client, 'delete_task', { projectId: 'p1', taskId: 't1' });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text)).toEqual({ taskId: 't1', deleted: true, branchKept: true });
    expect(mocks.deleteTask).toHaveBeenCalledWith('p1', 't1', {
      deleteWorktree: true,
      deleteBranch: false,
    });
  });
});
