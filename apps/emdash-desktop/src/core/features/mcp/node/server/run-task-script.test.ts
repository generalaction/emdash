import { err, ok } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import type { McpToolDependencies } from './dependencies';
import { runTaskScript, stopTaskScript } from './run-task-script';

const input = { projectId: 'project-1', taskId: 'task-1', type: 'run' as const };

function dependencies(options: {
  rows?: Array<{ workspaceId: string | null }>;
  runScript?: ReturnType<typeof vi.fn>;
  stop?: ReturnType<typeof vi.fn>;
  identity?: { host: { type: 'local'; id: 'local' }; path: string } | null;
}) {
  const runScript = options.runScript ?? vi.fn(async () => ok(undefined));
  const stop = options.stop ?? vi.fn(async () => ok(undefined));
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => options.rows ?? [{ workspaceId: 'workspace-1' }] }),
      }),
    }),
  };
  return {
    runScript,
    stop,
    dependencies: {
      db,
      runtimes: { client: async () => ok({ workspaceRegistry: { runScript }, scripts: { stop } }) },
      workspaceIdentity: {
        resolve: async () =>
          options.identity === undefined
            ? { host: { type: 'local', id: 'local' }, path: '/worktrees/task-1' }
            : options.identity,
      },
    } as unknown as McpToolDependencies,
  };
}

describe('runTaskScript', () => {
  it('starts the script through the host registry', async () => {
    const { dependencies: deps, runScript } = dependencies({});

    await expect(runTaskScript(deps, input)).resolves.toEqual({
      status: 'started',
      taskId: 'task-1',
      type: 'run',
    });
    expect(runScript).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      script: 'run',
      provenance: 'manual',
    });
  });

  it('reports no_script when the project has none configured', async () => {
    const { dependencies: deps } = dependencies({
      runScript: vi.fn(async () => err({ type: 'script-not-configured' })),
    });

    await expect(runTaskScript(deps, input)).resolves.toMatchObject({ status: 'no_script' });
  });

  it('reports already_running when a run is in flight', async () => {
    const { dependencies: deps } = dependencies({
      runScript: vi.fn(async () => err({ type: 'run-in-flight' })),
    });

    await expect(runTaskScript(deps, input)).resolves.toMatchObject({
      status: 'already_running',
    });
  });

  it('reports failures with the host message', async () => {
    const { dependencies: deps } = dependencies({
      runScript: vi.fn(async () => err({ type: 'io', message: 'disk on fire' })),
    });

    await expect(runTaskScript(deps, input)).resolves.toMatchObject({
      status: 'failed',
      message: 'disk on fire',
    });
  });

  it('reports not_found for an unknown task', async () => {
    const { dependencies: deps } = dependencies({ rows: [] });

    await expect(runTaskScript(deps, input)).resolves.toMatchObject({ status: 'not_found' });
  });

  it('reports not_found for a task without a workspace', async () => {
    const { dependencies: deps } = dependencies({ rows: [{ workspaceId: null }] });

    await expect(runTaskScript(deps, input)).resolves.toMatchObject({
      status: 'not_found',
      message: expect.stringContaining('no workspace'),
    });
  });

  it('reports not_found when the workspace is no longer known', async () => {
    const { dependencies: deps } = dependencies({ identity: null });

    await expect(runTaskScript(deps, input)).resolves.toMatchObject({ status: 'not_found' });
  });
});

describe('stopTaskScript', () => {
  it('stops the script at the workspace path', async () => {
    const { dependencies: deps, stop } = dependencies({});

    await expect(stopTaskScript(deps, input)).resolves.toEqual({
      status: 'stopped',
      taskId: 'task-1',
      type: 'run',
    });
    expect(stop).toHaveBeenCalledWith({ workspacePath: '/worktrees/task-1', script: 'run' });
  });

  it('reports not_running when nothing is running', async () => {
    const { dependencies: deps } = dependencies({
      stop: vi.fn(async () => err({ type: 'not-found' })),
    });

    await expect(stopTaskScript(deps, input)).resolves.toMatchObject({ status: 'not_running' });
  });
});
