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

type StatusSnapshot =
  | {
      kind: 'ok';
      summary: { staged: number; unstaged: number; conflicted: number; untracked: number };
    }
  | { kind: 'too-many-files' }
  | { kind: 'error'; message: string };

const CLEAN_STATUS: StatusSnapshot = {
  kind: 'ok',
  summary: { staged: 0, unstaged: 0, conflicted: 0, untracked: 0 },
};

const TASK_BRANCH = 'emdash/feat-task-1';

type HeadSnapshot =
  | { kind: 'branch'; ref: string; oid: string; upstream: unknown }
  | { kind: 'detached'; shortHash: string; oid: string };

/** A worktree on the task branch, tracking a pushed upstream. */
const ON_TASK_BRANCH: HeadSnapshot = {
  kind: 'branch',
  ref: `refs/heads/${TASK_BRANCH}`,
  oid: 'local-tip',
  upstream: {
    kind: 'remote',
    remote: 'origin',
    mergeRef: `refs/heads/${TASK_BRANCH}`,
    tracking: {
      kind: 'resolved',
      ref: 'refs/remotes/origin/x',
      oid: 'upstream-tip',
      ahead: 0,
      behind: 0,
    },
  },
};

/** The `git log` range count behind the branch check: a number of commits, or a throw. */
type BranchLog = number | Error;

/**
 * A runtimes client exposing the reads the delete gate makes: the watcher-
 * backed status and head snapshots, the fresh `git diff`, and the `git log`
 * range behind the branch check. A snapshot throws when its state is an Error,
 * mirroring a checkout the runtime cannot open at all; `getLog` throws when the
 * log is one.
 */
function fakeRuntimes(
  status: StatusSnapshot | Error,
  changedTrackedFiles = 0,
  head: HeadSnapshot | Error = ON_TASK_BRANCH,
  log: BranchLog = 0,
  getLog: ReturnType<typeof vi.fn> = vi.fn(async () => {
    if (log instanceof Error) throw log;
    return ok({ commits: [], totalCount: log });
  })
) {
  return {
    client: async () =>
      ok({
        git: {
          checkout: {
            model: {
              state: (_checkout: unknown, name: 'status' | 'head') => ({
                snapshot: async () => {
                  const data = name === 'head' ? head : status;
                  if (data instanceof Error) throw data;
                  return { data };
                },
              }),
            },
            getChangedFiles: async () =>
              ok({ files: Array.from({ length: changedTrackedFiles }, () => ({ path: 'a.txt' })) }),
            getLog,
          },
        },
      }),
  };
}

/**
 * One row that answers every query the tools make: the task lookup, its
 * workspace id, and the workspace's provisioned branch.
 */
const TASK_ROW = {
  id: 'task-1',
  workspaceId: 'workspace-1',
  kind: 'worktree',
  config: {
    git: {
      kind: 'create-branch',
      branchName: TASK_BRANCH,
      fromBranch: { type: 'local', branch: 'main' },
    },
  },
};

function dependencies(overrides: Partial<McpToolDependencies> = {}): McpToolDependencies {
  return {
    appVersion: '0.0.0',
    logger,
    db: fakeDb([TASK_ROW]),
    projects: {
      track: () => cell({ kind: 'attached' }),
      requireAttached: () => ok({}),
    },
    tasks: {},
    runtimes: fakeRuntimes(CLEAN_STATUS),
    workspaceIdentity: {
      resolve: async () => ({ host: { type: 'local', id: 'local' }, path: '/worktrees/task-1' }),
    },
    appSettings: { get: async () => ({}) },
    telemetry: { capture: () => {} },
    startInitialConversation: async () => ({ started: true }),
    ...overrides,
  } as unknown as McpToolDependencies;
}

/** Deps for delete_task: a worktree this task owns, with the given git state. */
function deleteDependencies(options: {
  status?: StatusSnapshot | Error;
  changedTrackedFiles?: number;
  hasWorktree?: boolean;
  hasDeletableBranch?: boolean;
  head?: HeadSnapshot | Error;
  log?: BranchLog;
  getLog?: ReturnType<typeof vi.fn>;
  deleteTask: ReturnType<typeof vi.fn>;
}): McpToolDependencies {
  return dependencies({
    runtimes: fakeRuntimes(
      options.status ?? CLEAN_STATUS,
      options.changedTrackedFiles ?? 0,
      options.head ?? ON_TASK_BRANCH,
      options.log ?? 0,
      options.getLog
    ) as never,
    tasks: {
      getDeletePreflight: async () => ({
        tasks: [
          {
            taskId: 'task-1',
            hasWorktree: options.hasWorktree ?? true,
            hasDeletableBranch: options.hasDeletableBranch ?? true,
          },
        ],
      }),
      deleteTask: options.deleteTask,
    } as never,
  });
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
    const deps = deleteDependencies({
      deleteTask,
      status: { kind: 'ok', summary: { staged: 1, unstaged: 2, conflicted: 0, untracked: 3 } },
    });

    const result = await callTool(deps, 'delete_task', { projectId: 'p', taskId: 'task-1' });

    expect(result.isError).toBeFalsy();
    expect(parse(result)).toMatchObject({
      deleted: false,
      requiresConfirmation: true,
      changes: { staged: 1, unstaged: 2, conflicted: 0, untracked: 3 },
    });
    expect(deleteTask).not.toHaveBeenCalled();
  });

  it('counts untracked files alone as needing confirmation', async () => {
    const deleteTask = vi.fn();
    const deps = deleteDependencies({
      deleteTask,
      status: { kind: 'ok', summary: { staged: 0, unstaged: 0, conflicted: 0, untracked: 1 } },
    });

    expect(
      parse(await callTool(deps, 'delete_task', { projectId: 'p', taskId: 'task-1' }))
    ).toMatchObject({ requiresConfirmation: true });
    expect(deleteTask).not.toHaveBeenCalled();
  });

  it('refuses when the worktree status cannot be read', async () => {
    const deleteTask = vi.fn();
    const deps = deleteDependencies({
      deleteTask,
      status: { kind: 'error', message: 'not a git repository' },
    });

    const result = parse(
      await callTool(deps, 'delete_task', { projectId: 'p', taskId: 'task-1' })
    ) as { requiresConfirmation?: boolean; reason?: string };

    expect(result.requiresConfirmation).toBe(true);
    expect(result.reason).toContain('could not check');
    expect(deleteTask).not.toHaveBeenCalled();
  });

  it('refuses when opening the checkout throws instead of reporting a state', async () => {
    const deleteTask = vi.fn();
    const deps = deleteDependencies({
      deleteTask,
      status: new Error('fatal: not a git repository'),
    });

    const result = parse(
      await callTool(deps, 'delete_task', { projectId: 'p', taskId: 'task-1' })
    ) as { requiresConfirmation?: boolean; reason?: string };

    expect(result.requiresConfirmation).toBe(true);
    expect(result.reason).toContain('could not check');
    expect(deleteTask).not.toHaveBeenCalled();
  });

  it('trusts the fresh diff when the watcher-backed summary still reads clean', async () => {
    const deleteTask = vi.fn();
    const deps = deleteDependencies({
      deleteTask,
      status: CLEAN_STATUS,
      changedTrackedFiles: 1,
    });

    expect(
      parse(await callTool(deps, 'delete_task', { projectId: 'p', taskId: 'task-1' }))
    ).toMatchObject({ requiresConfirmation: true, changes: null });
    expect(deleteTask).not.toHaveBeenCalled();
  });

  it('treats an oversized working set as dirty', async () => {
    const deleteTask = vi.fn();
    const deps = deleteDependencies({ deleteTask, status: { kind: 'too-many-files' } });

    expect(
      parse(await callTool(deps, 'delete_task', { projectId: 'p', taskId: 'task-1' }))
    ).toMatchObject({ requiresConfirmation: true, changes: null });
    expect(deleteTask).not.toHaveBeenCalled();
  });

  it('deletes a dirty worktree once confirmed, keeping the branch', async () => {
    const deleteTask = vi.fn(async () => ok(undefined));
    const deps = deleteDependencies({
      deleteTask,
      status: { kind: 'ok', summary: { staged: 0, unstaged: 4, conflicted: 0, untracked: 0 } },
    });

    expect(
      parse(
        await callTool(deps, 'delete_task', { projectId: 'p', taskId: 'task-1', confirm: true })
      )
    ).toEqual({
      taskId: 'task-1',
      deleted: true,
      conversationsDeleted: true,
      worktreeRemovalRequested: true,
      branchDeletionRequested: false,
      note: expect.any(String),
    });
    expect(deleteTask).toHaveBeenCalledWith('p', 'task-1', {
      deleteWorktree: true,
      deleteBranch: false,
      deleteConversations: true,
    });
  });

  it('deletes the branch when asked and it has no commits of its own', async () => {
    const deleteTask = vi.fn(async () => ok(undefined));
    const getLog = vi.fn(async () => ok({ commits: [], totalCount: 0 }));
    const deps = deleteDependencies({ deleteTask, getLog });

    expect(
      parse(
        await callTool(deps, 'delete_task', {
          projectId: 'p',
          taskId: 'task-1',
          deleteBranch: true,
        })
      )
    ).toMatchObject({ deleted: true, branchDeletionRequested: true });
    expect(deleteTask).toHaveBeenCalledWith('p', 'task-1', {
      deleteWorktree: true,
      deleteBranch: true,
      deleteConversations: true,
    });
    // Counted as the range from the upstream tip to the task branch itself.
    expect(getLog).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          base: { kind: 'commit', sha: 'upstream-tip' },
          head: { kind: 'branch', branch: { type: 'local', branch: TASK_BRANCH } },
        }),
      })
    );
  });

  it('compares a never-pushed branch against its source branch', async () => {
    const deleteTask = vi.fn(async () => ok(undefined));
    const getLog = vi.fn(async () => ok({ commits: [], totalCount: 0 }));
    const deps = deleteDependencies({
      deleteTask,
      getLog,
      head: { ...ON_TASK_BRANCH, upstream: { kind: 'none' } },
    });

    await callTool(deps, 'delete_task', { projectId: 'p', taskId: 'task-1', deleteBranch: true });

    expect(getLog).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          base: { kind: 'branch', branch: { type: 'local', branch: 'main' } },
        }),
      })
    );
    expect(deleteTask).toHaveBeenCalled();
  });

  it('refuses to delete a branch with commits of its own without confirmation', async () => {
    const deleteTask = vi.fn();
    const deps = deleteDependencies({ deleteTask, log: 2 });

    expect(
      parse(
        await callTool(deps, 'delete_task', {
          projectId: 'p',
          taskId: 'task-1',
          deleteBranch: true,
        })
      )
    ).toMatchObject({ deleted: false, requiresConfirmation: true, unpushedCommits: 2 });
    expect(deleteTask).not.toHaveBeenCalled();
  });

  it('refuses when the branch log cannot be read', async () => {
    const deleteTask = vi.fn();
    const deps = deleteDependencies({ deleteTask, log: new Error('fatal: bad object HEAD') });

    const result = parse(
      await callTool(deps, 'delete_task', { projectId: 'p', taskId: 'task-1', deleteBranch: true })
    ) as { requiresConfirmation?: boolean; reason?: string; unpushedCommits?: number | null };

    expect(result.requiresConfirmation).toBe(true);
    expect(result.unpushedCommits).toBeNull();
    expect(result.reason).toContain('unpushed commits');
    expect(deleteTask).not.toHaveBeenCalled();
  });

  it('reports both reasons when the worktree is dirty and the branch has its own commits', async () => {
    const deleteTask = vi.fn();
    const deps = deleteDependencies({
      deleteTask,
      status: { kind: 'ok', summary: { staged: 0, unstaged: 1, conflicted: 0, untracked: 0 } },
      log: 1,
    });

    const result = parse(
      await callTool(deps, 'delete_task', { projectId: 'p', taskId: 'task-1', deleteBranch: true })
    ) as { reason: string; unpushedCommits?: number; changes?: unknown };

    expect(result.reason).toContain('uncommitted changes');
    expect(result.reason).toContain(
      '1 commit not on its upstream or source branch; deleting the branch may lose it'
    );
    expect(result).toMatchObject({ unpushedCommits: 1, changes: { unstaged: 1 } });
    expect(deleteTask).not.toHaveBeenCalled();
  });

  it('keeps every branch when the worktree has a different branch checked out', async () => {
    const deleteTask = vi.fn(async () => ok(undefined));
    const getLog = vi.fn();
    const deps = deleteDependencies({
      deleteTask,
      getLog,
      head: { ...ON_TASK_BRANCH, ref: 'refs/heads/main' },
    });

    expect(
      parse(
        await callTool(deps, 'delete_task', {
          projectId: 'p',
          taskId: 'task-1',
          deleteBranch: true,
        })
      )
    ).toMatchObject({
      deleted: true,
      branchDeletionRequested: false,
      branchKeptReason: expect.stringContaining('main checked out'),
    });
    expect(getLog).not.toHaveBeenCalled();
    expect(deleteTask).toHaveBeenCalledWith('p', 'task-1', {
      deleteWorktree: true,
      deleteBranch: false,
      deleteConversations: true,
    });
  });

  it('keeps every branch when the worktree is detached', async () => {
    const deleteTask = vi.fn(async () => ok(undefined));
    const deps = deleteDependencies({
      deleteTask,
      log: 3,
      head: { kind: 'detached', shortHash: 'abc1234', oid: 'abc1234' },
    });

    expect(
      parse(
        await callTool(deps, 'delete_task', {
          projectId: 'p',
          taskId: 'task-1',
          deleteBranch: true,
        })
      )
    ).toMatchObject({ branchDeletionRequested: false, branchKeptReason: expect.any(String) });
    expect(deleteTask).toHaveBeenCalledWith(
      'p',
      'task-1',
      expect.objectContaining({ deleteBranch: false })
    );
  });

  it('keeps the branch and gates the worktree when the host is unreachable', async () => {
    const deleteTask = vi.fn(async () => ok(undefined));
    const deps = deleteDependencies({ deleteTask });
    deps.runtimes.client = (async () => ({ success: false, error: { type: 'offline' } })) as never;

    expect(
      parse(
        await callTool(deps, 'delete_task', {
          projectId: 'p',
          taskId: 'task-1',
          deleteBranch: true,
          confirm: true,
        })
      )
    ).toMatchObject({
      deleted: true,
      branchDeletionRequested: false,
      branchKeptReason: expect.stringContaining('could not check the task branch'),
    });
    expect(deleteTask).toHaveBeenCalledWith(
      'p',
      'task-1',
      expect.objectContaining({ deleteBranch: false })
    );
  });

  it('keeps a branch the task did not create and skips the branch check', async () => {
    const deleteTask = vi.fn(async () => ok(undefined));
    const getLog = vi.fn();
    const deps = deleteDependencies({ deleteTask, hasDeletableBranch: false, getLog });

    expect(
      parse(
        await callTool(deps, 'delete_task', {
          projectId: 'p',
          taskId: 'task-1',
          deleteBranch: true,
        })
      )
    ).toMatchObject({
      deleted: true,
      branchDeletionRequested: false,
      branchKeptReason: expect.any(String),
    });
    expect(getLog).not.toHaveBeenCalled();
    expect(deleteTask).toHaveBeenCalledWith('p', 'task-1', {
      deleteWorktree: true,
      deleteBranch: false,
      deleteConversations: true,
    });
  });

  it('keeps the worktree and branch without a git check when asked to', async () => {
    const deleteTask = vi.fn(async () => ok(undefined));
    const deps = deleteDependencies({
      deleteTask,
      // Would demand confirmation if it were consulted.
      status: { kind: 'ok', summary: { staged: 1, unstaged: 0, conflicted: 0, untracked: 0 } },
    });

    expect(
      parse(
        await callTool(deps, 'delete_task', {
          projectId: 'p',
          taskId: 'task-1',
          deleteWorktree: false,
          deleteBranch: true,
          deleteConversations: false,
        })
      )
    ).toMatchObject({
      deleted: true,
      worktreeRemovalRequested: false,
      branchDeletionRequested: false,
      conversationsDeleted: false,
    });
    expect(deleteTask).toHaveBeenCalledWith('p', 'task-1', {
      deleteWorktree: false,
      deleteBranch: false,
      deleteConversations: false,
    });
  });

  it('deletes a clean worktree without confirmation', async () => {
    const deleteTask = vi.fn(async () => ok(undefined));
    const deps = deleteDependencies({ deleteTask });

    expect(
      parse(await callTool(deps, 'delete_task', { projectId: 'p', taskId: 'task-1' }))
    ).toMatchObject({ deleted: true });
    expect(deleteTask).toHaveBeenCalled();
  });

  it('skips the git check when the delete leaves the worktree in place', async () => {
    const deleteTask = vi.fn(async () => ok(undefined));
    const deps = deleteDependencies({
      deleteTask,
      hasWorktree: false,
      // Would demand confirmation if it were consulted.
      status: { kind: 'ok', summary: { staged: 9, unstaged: 9, conflicted: 0, untracked: 0 } },
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
