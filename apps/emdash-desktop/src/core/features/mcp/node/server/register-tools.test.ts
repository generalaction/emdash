import { ok } from '@emdash/shared';
import { cell } from '@emdash/wire/state';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpToolDependencies } from './dependencies';
import { buildEmdashMcpServer } from './register-tools';

type ToolText = { content: Array<{ type: string; text: string }>; isError?: boolean };

const logError = vi.fn();
const logger = { info: () => {}, warn: () => {}, error: logError, debug: () => {} } as never;

function fakeDb(rows: unknown[]) {
  const chain = {
    from: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve(rows),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve),
  };
  return { select: () => chain };
}

function dependencies(overrides: Partial<McpToolDependencies> = {}): McpToolDependencies {
  return {
    appVersion: '0.0.0',
    logger,
    db: fakeDb([{ id: 'task-1' }]),
    projects: {
      track: () => cell({ kind: 'attached' }),
      requireAttached: () => ok({}),
    },
    tasks: {},
    runtimes: { client: async () => ok({}) },
    workspaceIdentity: { resolve: async () => null },
    appSettings: { get: async () => ({}) },
    telemetry: { capture: () => {} },
    startInitialConversation: async () => ({ started: true }),
    ...overrides,
  } as unknown as McpToolDependencies;
}

async function connect(deps: McpToolDependencies): Promise<Client> {
  const server = buildEmdashMcpServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

async function callTool(
  deps: McpToolDependencies,
  name: string,
  args: Record<string, unknown>
): Promise<ToolText> {
  const client = await connect(deps);
  return (await client.callTool({ name, arguments: args })) as ToolText;
}

function parse(result: ToolText): unknown {
  return JSON.parse(result.content[0].text);
}

describe('buildEmdashMcpServer', () => {
  beforeEach(() => {
    logError.mockClear();
  });

  it('exposes the documented tool set', async () => {
    const client = await connect(dependencies());

    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'archive_task',
      'create_task',
      'delete_task',
      'list_projects',
      'list_tasks',
      'rename_task',
      'run_task_script',
      'stop_task_script',
    ]);
  });

  it('lists projects', async () => {
    const deps = dependencies({
      db: fakeDb([{ id: 'project-1', name: 'emdash' }]) as never,
    });

    expect(parse(await callTool(deps, 'list_projects', {}))).toEqual([
      { id: 'project-1', name: 'emdash' },
    ]);
  });

  it('renames a task', async () => {
    const renameTask = vi.fn(async () => ok({ task: { name: 'new name' } }));
    const deps = dependencies({ tasks: { renameTask } as never });

    expect(
      parse(
        await callTool(deps, 'rename_task', { projectId: 'p', taskId: 't', name: ' new name ' })
      )
    ).toEqual({ taskId: 't', name: 'new name' });
    expect(renameTask).toHaveBeenCalledWith('p', 't', 'new name');
  });

  it('rejects an empty rename', async () => {
    const renameTask = vi.fn();
    const deps = dependencies({ tasks: { renameTask } as never });

    const result = await callTool(deps, 'rename_task', { projectId: 'p', taskId: 't', name: '  ' });
    expect(result.isError).toBe(true);
    expect(renameTask).not.toHaveBeenCalled();
  });

  it('refuses to delete a dirty worktree without confirmation', async () => {
    const deleteTask = vi.fn();
    const deps = dependencies({
      tasks: {
        getDeletePreflight: async () => ({
          tasks: [{ taskId: 'task-1', hasUncommittedChanges: true, changedLines: 12 }],
        }),
        deleteTask,
      } as never,
    });

    const result = await callTool(deps, 'delete_task', { projectId: 'p', taskId: 'task-1' });

    expect(result.isError).toBeFalsy();
    expect(parse(result)).toMatchObject({
      deleted: false,
      requiresConfirmation: true,
      changedLines: 12,
    });
    expect(deleteTask).not.toHaveBeenCalled();
  });

  it('deletes a dirty worktree once confirmed, keeping the branch', async () => {
    const deleteTask = vi.fn(async () => ok(undefined));
    const deps = dependencies({
      tasks: {
        getDeletePreflight: async () => ({
          tasks: [{ taskId: 'task-1', hasUncommittedChanges: true }],
        }),
        deleteTask,
      } as never,
    });

    expect(
      parse(
        await callTool(deps, 'delete_task', { projectId: 'p', taskId: 'task-1', confirm: true })
      )
    ).toEqual({ taskId: 'task-1', deleted: true, branchKept: true });
    expect(deleteTask).toHaveBeenCalledWith('p', 'task-1', {
      deleteWorktree: true,
      deleteBranch: false,
    });
  });

  it('deletes a clean worktree without confirmation', async () => {
    const deleteTask = vi.fn(async () => ok(undefined));
    const deps = dependencies({
      tasks: {
        getDeletePreflight: async () => ({
          tasks: [{ taskId: 'task-1', hasUncommittedChanges: false }],
        }),
        deleteTask,
      } as never,
    });

    expect(
      parse(await callTool(deps, 'delete_task', { projectId: 'p', taskId: 'task-1' }))
    ).toMatchObject({ deleted: true });
    expect(deleteTask).toHaveBeenCalled();
  });

  it('does not leak internal errors to the caller', async () => {
    const deps = dependencies({
      tasks: {
        renameTask: async () => {
          throw new Error('SQLITE_BUSY: /Users/someone/Library/emdash/app.db');
        },
      } as never,
    });

    const result = await callTool(deps, 'rename_task', { projectId: 'p', taskId: 't', name: 'x' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Emdash hit an internal error while handling rename_task');
    expect(logError).toHaveBeenCalled();
  });
});
