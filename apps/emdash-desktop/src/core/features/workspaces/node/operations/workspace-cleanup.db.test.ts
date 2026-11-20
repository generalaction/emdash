import type { WorkspaceRecord } from '@emdash/core/runtimes/workspace-registry/api';
import { openFixture } from '@tooling/utils/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceRegistry } from '@core/features/workspaces/api/node/registry';
import type { WorkspaceConfig } from '@core/primitives/workspaces/api';
import { appDbPokes } from '@core/services/app-db/node/pokes';
import type { WorkspaceInsert } from '@core/services/app-db/node/schema';
import { applyWorkspaceRegistrySnapshot } from '../sync/apply-workspace-registry-snapshot';
import {
  findCleanableMissingWorktrees,
  getWorkspaceCleanupPreview,
  runWorkspaceCleanup,
  untrackCleanableMissingWorktrees,
} from './workspace-cleanup';

const someConfig: WorkspaceConfig = {
  version: '2',
  git: { kind: 'none' },
  workspace: { kind: 'new-worktree' },
};

function hostRecord(id: string, path: string): WorkspaceRecord {
  return {
    id,
    kind: 'worktree',
    path,
    parentId: null,
    origin: 'registered',
    gitAdminName: id,
    observedStatus: 'missing',
    creation: null,
    lastCreateOutcome: null,
    lastRemovalAttempt: null,
    lifecycle: null,
    git: null,
    lastActivatedAt: null,
    createdAt: 1,
    updatedAt: 1,
    lastObservedAt: 1,
    config: null,
    runtime: null,
  };
}

describe('workspace cleanup', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  beforeEach(async () => {
    fixture = await openFixture('empty');
    fixture.sqlite.prepare(`INSERT INTO projects (id, name) VALUES ('project-1', 'p')`).run();
  });

  afterEach(() => {
    fixture.close();
    vi.restoreAllMocks();
  });

  function seedRow(
    id: string,
    { missing = true, ...overrides }: Partial<WorkspaceInsert> & { missing?: boolean } = {}
  ): void {
    const registry = createWorkspaceRegistry(fixture.db);
    registry.recordCreationIntent({
      id,
      type: 'local',
      kind: 'worktree',
      location: 'local',
      sshConnectionId: null,
      path: `/work/${id}`,
      config: someConfig,
      ...overrides,
    });
    registry.refresh(id, { observedStatus: missing ? 'missing' : 'present', observedAt: 1 });
  }

  function seedTask(
    id: string,
    workspaceId: string,
    state: { archivedAt?: string; deletedAt?: string } = {}
  ): void {
    fixture.sqlite
      .prepare(
        `INSERT INTO tasks (id, project_id, name, status, workspace_id, archived_at, deleted_at)
         VALUES (?, 'project-1', ?, 'in_progress', ?, ?, ?)`
      )
      .run(id, id, workspaceId, state.archivedAt ?? null, state.deletedAt ?? null);
  }

  function candidateIds(): string[] {
    return findCleanableMissingWorktrees(fixture.db)
      .map((row) => row.workspaceId)
      .sort();
  }

  it('selects missing worktrees whose tasks are all archived, deleted, or absent', () => {
    seedRow('wt-archived');
    seedTask('t-archived', 'wt-archived', { archivedAt: '2026-01-01T00:00:00.000Z' });
    seedRow('wt-deleted');
    seedTask('t-deleted', 'wt-deleted', { deletedAt: '2026-01-01T00:00:00.000Z' });
    seedRow('wt-unlinked');

    expect(candidateIds()).toEqual(['wt-archived', 'wt-deleted', 'wt-unlinked']);
  });

  it('keeps rows that something still needs', () => {
    seedRow('wt-open-task');
    seedTask('t-open', 'wt-open-task');
    seedRow('wt-mixed');
    seedTask('t-mixed-archived', 'wt-mixed', { archivedAt: '2026-01-01T00:00:00.000Z' });
    seedTask('t-mixed-open', 'wt-mixed');
    seedRow('wt-present', { missing: false });
    seedRow('ws-repo', { kind: 'repository' });
    seedRow('wt-project-repo');
    fixture.sqlite.prepare(`UPDATE projects SET repository_workspace_id = 'wt-project-repo'`).run();
    seedRow('wt-tombstoned');
    createWorkspaceRegistry(fixture.db).tombstone('wt-tombstoned', {
      version: '1',
      targetRecordId: 'wt-tombstoned',
      tombstonedAt: 1,
      options: { deleteBranch: false, deleteConversations: false },
    });
    seedRow('wt-untracked');
    createWorkspaceRegistry(fixture.db).untrack(['wt-untracked'], '2026-01-01T00:00:00.000Z');

    expect(candidateIds()).toEqual([]);
  });

  it('untracks candidates durably so sync does not resurrect them', async () => {
    const poke = vi.spyOn(appDbPokes.workspaces, 'poke');
    seedRow('wt-gone');
    seedTask('t-gone', 'wt-gone', { archivedAt: '2026-01-01T00:00:00.000Z' });
    seedRow('wt-keep');
    seedTask('t-keep', 'wt-keep');

    expect(untrackCleanableMissingWorktrees(fixture.db)).toBe(1);
    expect(poke).toHaveBeenCalledTimes(1);

    const registry = createWorkspaceRegistry(fixture.db);
    expect(registry.getLive('wt-gone')).toBeUndefined();
    expect(registry.getLive('wt-keep')).toBeDefined();

    const applied = await applyWorkspaceRegistrySnapshot({
      db: fixture.db,
      host: { location: 'local', sshConnectionId: null },
      records: {
        'wt-gone': hostRecord('wt-gone', '/work/wt-gone'),
        'wt-keep': hostRecord('wt-keep', '/work/wt-keep'),
      },
    });
    expect(applied.adopted).toBe(0);
    expect(registry.getLive('wt-gone')).toBeUndefined();
  });

  it('does not poke when there is nothing to untrack', () => {
    const poke = vi.spyOn(appDbPokes.workspaces, 'poke');
    expect(untrackCleanableMissingWorktrees(fixture.db)).toBe(0);
    expect(poke).not.toHaveBeenCalled();
  });

  it('previews and runs the selected steps', () => {
    seedRow('wt-gone');

    const preview = getWorkspaceCleanupPreview(fixture.db);
    expect(preview.missingWorktrees).toEqual([{ workspaceId: 'wt-gone', path: '/work/wt-gone' }]);
    expect(preview.database.fileBytes).toBeGreaterThan(0);

    expect(
      runWorkspaceCleanup(fixture.db, { untrackMissing: false, compactDatabase: false })
    ).toEqual({ success: true, data: { untracked: 0, freedBytes: 0 } });
    expect(candidateIds()).toEqual(['wt-gone']);

    const result = runWorkspaceCleanup(fixture.db, { untrackMissing: true, compactDatabase: true });
    expect(result.success).toBe(true);
    expect(result.success && result.data.untracked).toBe(1);
    expect(candidateIds()).toEqual([]);
  });
});
