import type { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import { hostRef, LOCAL_HOST_REF, type HostRef } from '@emdash/core/primitives/host/api';
import { openFixture } from '@tooling/utils/db';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createWorkspaceRegistry } from '@core/features/workspaces/api/node/registry';
import type { WorkspaceInsert } from '@core/services/app-db/node/schema';
import { WorkspaceRegistryBackfillService } from './workspace-registry-backfill';

/**
 * Upgrade backfill: annotated mirror rows flow upward as idempotent `createWorkspace`
 * requests with their existing UUIDs — repositories before worktrees — once per host
 * behind a completed flag. Adopted-never-annotated rows are left for host auto-adoption.
 */
describe('WorkspaceRegistryBackfillService', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;
  let createWorkspace: Mock<(input: unknown) => Promise<unknown>>;
  let reachable: boolean;
  let errors: string[];
  let service: WorkspaceRegistryBackfillService;

  beforeEach(async () => {
    fixture = await openFixture('empty');
    createWorkspace = vi.fn(async () => ({ success: true as const, data: {} }));
    reachable = true;
    errors = [];
    const broker = {
      client: async () =>
        reachable
          ? { success: true, data: { workspaceRegistry: { createWorkspace } } }
          : { success: false, error: { type: 'host-unavailable', message: 'offline' } },
    } as unknown as RuntimeBroker;
    service = new WorkspaceRegistryBackfillService({
      db: fixture.db,
      runtimes: broker,
      onError: (context) => errors.push(context),
    });
  });

  afterEach(() => {
    fixture.close();
  });

  function seedRow(id: string, overrides: Partial<WorkspaceInsert> = {}): void {
    createWorkspaceRegistry(fixture.db).register({
      id,
      type: 'local',
      kind: 'worktree',
      location: 'local',
      sshConnectionId: null,
      path: `/work/${id}`,
      config: { version: '2', git: { kind: 'none' }, workspace: { kind: 'new-worktree' } },
      ...overrides,
    });
  }

  function linkTask(taskId: string, workspaceId: string): void {
    fixture.sqlite
      .prepare(`INSERT INTO projects (id, name) VALUES (?, ?)`)
      .run(`project-for-${taskId}`, 'p');
    fixture.sqlite
      .prepare(
        `INSERT INTO tasks (id, project_id, name, status, workspace_id)
         VALUES (?, ?, ?, 'running', ?)`
      )
      .run(taskId, `project-for-${taskId}`, taskId, workspaceId);
  }

  function seedRemoteConnection(connectionId: string): void {
    fixture.sqlite
      .prepare(
        `INSERT INTO ssh_connections (id, name, host, username) VALUES (?, ?, 'example.test', 'user')`
      )
      .run(connectionId, connectionId);
  }

  async function run(host: HostRef = LOCAL_HOST_REF): Promise<void> {
    await service.backfillHost(host);
  }

  function replayedIds(): string[] {
    return createWorkspace.mock.calls.map(([input]) => (input as { id: string }).id);
  }

  it('replays annotated rows with preserved ids, repositories before worktrees, exactly once', async () => {
    seedRow('wt-1');
    seedRow('repo-1', { kind: 'repository', path: '/work/repo' });
    seedRow('wt-2', { path: '/work/wt-2' });
    // Adopted-never-annotated: config null, no links — host auto-adoption rediscovers it.
    createWorkspaceRegistry(fixture.db).adopt({
      id: 'wt-mirror',
      type: 'local',
      kind: 'worktree',
      location: 'local',
      path: '/work/mirror',
    });
    // Untracked and remote rows are out of scope for the local sweep.
    seedRemoteConnection('conn-1');
    seedRow('wt-remote', { location: 'remote', sshConnectionId: 'conn-1' });
    seedRow('wt-gone');
    createWorkspaceRegistry(fixture.db).untrack(['wt-gone'], '2026-01-02T00:00:00.000Z');

    await run();

    expect(replayedIds()).toEqual(['repo-1', 'wt-1', 'wt-2']);
    expect(createWorkspace).toHaveBeenCalledWith({ id: 'repo-1', path: '/work/repo' });

    // The per-host flag prevents re-runs.
    createWorkspace.mockClear();
    await run();
    expect(createWorkspace).not.toHaveBeenCalled();
  });

  it('backfills adopted rows that gained annotations (a task link counts)', async () => {
    createWorkspaceRegistry(fixture.db).adopt({
      id: 'wt-linked',
      type: 'local',
      kind: 'worktree',
      location: 'local',
      path: '/work/linked',
    });
    linkTask('task-1', 'wt-linked');

    await run();
    expect(replayedIds()).toEqual(['wt-linked']);
  });

  it('tracks the flag per host: the remote sweep runs independently of the local one', async () => {
    seedRemoteConnection('conn-1');
    seedRow('wt-remote', { location: 'remote', sshConnectionId: 'conn-1' });

    await run();
    expect(createWorkspace).not.toHaveBeenCalled();

    await run(hostRef('remote', 'conn-1'));
    expect(replayedIds()).toEqual(['wt-remote']);
  });

  it('continues past per-row failures (vanished paths) but resumes after a transport throw', async () => {
    seedRow('wt-1');
    seedRow('wt-2', { path: '/work/wt-2' });
    createWorkspace.mockImplementationOnce(async () => ({
      success: false as const,
      error: { type: 'path-not-found', path: '/work/wt-1' },
    }));

    await run();
    // The failed row is logged, the sweep completes, and the flag is set.
    expect(createWorkspace).toHaveBeenCalledTimes(2);
    expect(errors).toEqual(['workspace registry backfill create (wt-1)']);
    createWorkspace.mockClear();
    await run();
    expect(createWorkspace).not.toHaveBeenCalled();

    // A transport throw leaves the flag unset; the next attempt walks again from the top.
    fixture.sqlite.prepare(`DELETE FROM kv`).run();
    createWorkspace.mockClear();
    createWorkspace.mockImplementationOnce(async () => {
      throw new Error('transport dropped');
    });
    await run();
    expect(createWorkspace).toHaveBeenCalledTimes(1);
    createWorkspace.mockClear();
    await run();
    expect(createWorkspace).toHaveBeenCalledTimes(2);
  });

  it('leaves rows of an unreachable host untouched; no flag, no calls', async () => {
    seedRow('wt-1');
    reachable = false;

    await run();
    expect(createWorkspace).not.toHaveBeenCalled();

    // The obligation never expires: the first reachable attempt completes it.
    reachable = true;
    await run();
    expect(replayedIds()).toEqual(['wt-1']);
  });
});
