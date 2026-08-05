import type { WorkspaceRecord } from '@emdash/core/runtimes/workspace-registry/api';
import { openFixture } from '@tooling/utils/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkspaceRegistry } from '@core/features/workspaces/api/node/registry';
import { applyWorkspaceRegistrySnapshot } from './apply-workspace-registry-snapshot';

const LOCAL_HOST = { location: 'local', sshConnectionId: null } as const;

function hostRecord(overrides: Partial<WorkspaceRecord> & { id: string }): WorkspaceRecord {
  return {
    kind: 'worktree',
    path: `/worktrees/${overrides.id}`,
    parentId: 'ws-repo',
    origin: 'registered',
    gitAdminName: overrides.id,
    observedStatus: 'present',
    creation: null,
    lastCreateOutcome: null,
    git: {
      branch: 'feature/x',
      dirty: true,
      diffStats: { added: 12, deleted: 3 },
      ahead: 1,
      behind: 0,
      locked: false,
      prunable: false,
    },
    lastActivatedAt: null,
    createdAt: Date.parse('2026-01-01T00:00:00.000Z'),
    updatedAt: Date.parse('2026-01-02T00:00:00.000Z'),
    lastObservedAt: Date.parse('2026-01-02T00:00:00.000Z'),
    runtime: null,
    ...overrides,
  };
}

/**
 * Convergence from the workspace registry `records` live model (ADR 0005). The mirror
 * is never the authority: deliveries overwrite observation columns wholesale (git
 * block, create outcome, runtime overlay included) and never touch annotations; the
 * sweep follows the missing rules and is scoped to the delivering host.
 */
describe('applyWorkspaceRegistrySnapshot', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  beforeEach(async () => {
    fixture = await openFixture('empty');
  });

  afterEach(() => {
    fixture.close();
  });

  function seedTask(projectId: string, taskId: string, workspaceId: string): void {
    fixture.sqlite
      .prepare(`INSERT INTO projects (id, name) VALUES (?, ?)`)
      .run(projectId, `project-${projectId}`);
    fixture.sqlite
      .prepare(
        `INSERT INTO tasks (id, project_id, name, status, workspace_id)
         VALUES (?, ?, ?, 'running', ?)`
      )
      .run(taskId, projectId, `task-${taskId}`, workspaceId);
  }

  it('adopts unknown host records with observations populated (wiped-client reconvergence)', async () => {
    const result = await applyWorkspaceRegistrySnapshot({
      db: fixture.db,
      host: LOCAL_HOST,
      records: {
        'ws-repo': hostRecord({
          id: 'ws-repo',
          kind: 'repository',
          path: '/repos/app',
          parentId: null,
          gitAdminName: null,
        }),
        'wt-1': hostRecord({
          id: 'wt-1',
          lastCreateOutcome: { status: 'succeeded', at: Date.parse('2026-01-01T12:00:00.000Z') },
        }),
      },
      observedAt: Date.parse('2026-01-03T00:00:00.000Z'),
    });

    expect(result).toEqual({ adopted: 2, refreshed: 0, markedMissing: 0, untracked: 0 });

    const registry = createWorkspaceRegistry(fixture.db);
    expect(registry.getLive('wt-1')).toMatchObject({
      origin: 'registered',
      kind: 'worktree',
      path: '/worktrees/wt-1',
      parentId: 'ws-repo',
      config: null,
      observedStatus: 'present',
      observedGit: {
        version: '1',
        branch: 'feature/x',
        dirty: true,
        diffStats: { added: 12, deleted: 3 },
      },
      lastCreateOutcome: { version: '1', status: 'succeeded' },
      runtimeOverlay: null,
      observedAt: Date.parse('2026-01-03T00:00:00.000Z'),
      // Legacy read paths stay live until the read rewiring lands.
      observedGitBranch: 'feature/x',
      linesAdded: 12,
      linesDeleted: 3,
      location: 'local',
      sshConnectionId: null,
    });

    // Reconvergence is idempotent: a replayed snapshot refreshes instead of duplicating.
    const replay = await applyWorkspaceRegistrySnapshot({
      db: fixture.db,
      host: LOCAL_HOST,
      records: {
        'ws-repo': hostRecord({ id: 'ws-repo', kind: 'repository', parentId: null }),
        'wt-1': hostRecord({ id: 'wt-1' }),
      },
    });
    expect(replay).toEqual({ adopted: 0, refreshed: 2, markedMissing: 0, untracked: 0 });
  });

  it('overwrites observations wholesale — overlay included — but never touches annotations', async () => {
    const registry = createWorkspaceRegistry(fixture.db);
    registry.register({
      id: 'wt-1',
      type: 'local',
      kind: 'worktree',
      location: 'local',
      path: '/worktrees/wt-1',
      config: { version: '2', git: { kind: 'none' }, workspace: { kind: 'new-worktree' } },
      observedGitBranch: 'stale-branch',
      linesAdded: 999,
      linesDeleted: 999,
    });

    const withOverlay = await applyWorkspaceRegistrySnapshot({
      db: fixture.db,
      host: LOCAL_HOST,
      records: {
        'wt-1': hostRecord({
          id: 'wt-1',
          runtime: {
            creation: null,
            notices: [],
            activation: {
              phase: 'active',
              scripts: { prepare: 'succeeded', setup: 'running', run: 'pending' },
              activatedAt: Date.parse('2026-01-05T00:00:00.000Z'),
            },
          },
          lastActivatedAt: Date.parse('2026-01-05T00:00:00.000Z'),
        }),
      },
    });
    expect(withOverlay).toEqual({ adopted: 0, refreshed: 1, markedMissing: 0, untracked: 0 });
    expect(registry.getLive('wt-1')).toMatchObject({
      observedGitBranch: 'feature/x',
      linesAdded: 12,
      linesDeleted: 3,
      lastActivatedAt: Date.parse('2026-01-05T00:00:00.000Z'),
      runtimeOverlay: { version: '1', activation: { phase: 'active' } },
      // The rich-provenance annotation is client-owned; the snapshot cannot touch it.
      config: { version: '2', git: { kind: 'none' }, workspace: { kind: 'new-worktree' } },
    });

    // A daemon restart delivers runtime null — the persisted overlay column clears.
    await applyWorkspaceRegistrySnapshot({
      db: fixture.db,
      host: LOCAL_HOST,
      records: { 'wt-1': hostRecord({ id: 'wt-1', runtime: null }) },
    });
    expect(registry.getLive('wt-1')).toMatchObject({ runtimeOverlay: null });
  });

  it('sweeps unmatched rows: annotated go visible-missing, pure mirror rows untrack', async () => {
    const registry = createWorkspaceRegistry(fixture.db);
    registry.register({
      id: 'wt-linked',
      type: 'local',
      kind: 'worktree',
      location: 'local',
      path: '/worktrees/linked',
      config: null,
    });
    seedTask('project-1', 'task-1', 'wt-linked');
    registry.adopt({
      id: 'wt-mirror',
      type: 'local',
      kind: 'worktree',
      location: 'local',
      path: '/worktrees/mirror',
    });

    const result = await applyWorkspaceRegistrySnapshot({
      db: fixture.db,
      host: LOCAL_HOST,
      records: {},
      observedAt: Date.parse('2026-01-07T00:00:00.000Z'),
    });

    expect(result).toEqual({ adopted: 0, refreshed: 0, markedMissing: 1, untracked: 1 });
    expect(registry.getLive('wt-linked')).toMatchObject({
      observedStatus: 'missing',
      observedAt: Date.parse('2026-01-07T00:00:00.000Z'),
    });
    expect(registry.getLive('wt-mirror')).toBeUndefined();
  });

  it('scopes the sweep to the snapshot host; other hosts are untouched', async () => {
    const registry = createWorkspaceRegistry(fixture.db);
    fixture.sqlite
      .prepare(
        `INSERT INTO ssh_connections (id, name, host, port, username, auth_type)
         VALUES ('ssh-1', 'box', 'box.example', 22, 'dev', 'agent')`
      )
      .run();
    registry.adopt({
      id: 'wt-remote',
      type: 'project-ssh',
      kind: 'worktree',
      location: 'remote',
      sshConnectionId: 'ssh-1',
      path: '/remote/worktree',
      observedStatus: 'present',
    });

    const result = await applyWorkspaceRegistrySnapshot({
      db: fixture.db,
      host: LOCAL_HOST,
      records: {},
    });

    expect(result).toEqual({ adopted: 0, refreshed: 0, markedMissing: 0, untracked: 0 });
    expect(registry.getLive('wt-remote')).toMatchObject({ observedStatus: 'present' });
  });
});
