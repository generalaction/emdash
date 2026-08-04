import { openFixture } from '@tooling/utils/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createWorkspaceRegistry,
  isAnnotatedWorkspace,
  workspaceRegistryTable,
} from './workspace-registry';

describe('WorkspaceRegistry', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  beforeEach(async () => {
    fixture = await openFixture('empty');
  });

  afterEach(() => {
    fixture.close();
  });

  it('registers managed rows and adopts rows without provenance', async () => {
    const registry = createWorkspaceRegistry(fixture.db, {
      now: () => '2026-01-01T00:00:00.000Z',
    });

    registry.register({
      id: 'managed',
      type: 'local',
      kind: 'worktree',
      location: 'local',
      path: '/repo/managed',
      config: { version: '2', git: { kind: 'none' }, workspace: { kind: 'new-worktree' } },
    });
    registry.adopt({
      id: 'adopted',
      type: 'local',
      kind: 'worktree',
      location: 'local',
      path: '/repo/adopted',
    });

    expect(registry.getLive('managed')?.config).not.toBeNull();
    expect(registry.getLive('adopted')?.config).toBeNull();
  });

  it('refreshes only host observations', async () => {
    const registry = createWorkspaceRegistry(fixture.db, {
      now: () => '2026-01-02T00:00:00.000Z',
    });
    registry.adopt({
      id: 'workspace',
      type: 'local',
      kind: 'worktree',
      location: 'local',
      path: '/old',
    });

    registry.refresh('workspace', {
      path: '/new',
      observedStatus: 'present',
      observedGitBranch: 'main',
      observedData: { version: '1', dirty: true },
      lastObservedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(registry.getLive('workspace')).toMatchObject({
      path: '/new',
      observedStatus: 'present',
      observedGitBranch: 'main',
      observedData: { version: '1', dirty: true },
      lastObservedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
  });

  it('untracks and reverts atomically through an optional transaction', async () => {
    const registry = createWorkspaceRegistry(fixture.db);
    registry.adopt({
      id: 'workspace',
      type: 'local',
      kind: 'worktree',
      location: 'local',
      path: '/repo/worktree',
    });

    const changed = fixture.db.transaction((tx) =>
      registry.untrack(
        ['workspace'],
        '2026-01-01T00:00:00.000Z',
        { observedStatus: 'missing', lastObservedAt: '2026-01-01T00:00:00.000Z' },
        tx
      )
    );
    expect(changed).toBe(1);
    expect(registry.getLive('workspace')).toBeUndefined();

    fixture.db.transaction((tx) => registry.revertUntrack(['workspace'], tx));
    expect(registry.getLive('workspace')).toBeDefined();
  });

  it('resurrects and annotates an untracked row', async () => {
    const registry = createWorkspaceRegistry(fixture.db);
    registry.adopt({
      id: 'workspace',
      type: 'local',
      kind: 'worktree',
      location: 'local',
      path: '/old',
    });
    registry.untrack(['workspace'], '2026-01-01T00:00:00.000Z');

    registry.annotate('workspace', {
      path: '/new',
      config: { version: '2', git: { kind: 'none' }, workspace: { kind: 'new-worktree' } },
    });
    registry.resurrect('workspace');

    expect(registry.getLive('workspace')).toMatchObject({
      path: '/new',
      untrackedAt: null,
    });
  });

  it('purges only rows that are already untracked', async () => {
    const registry = createWorkspaceRegistry(fixture.db);
    registry.adopt({
      id: 'workspace',
      type: 'local',
      kind: 'worktree',
      location: 'local',
      path: '/repo/worktree',
    });

    expect(() => registry.purge(['workspace'])).toThrow('must be untracked');
    registry.untrack(['workspace'], '2026-01-01T00:00:00.000Z');
    expect(registry.purge(['workspace'])).toBe(1);
    expect(
      fixture.db
        .select()
        .from(workspaceRegistryTable)
        .all()
        .map((row) => row.id)
    ).not.toContain('workspace');
  });

  it('defines annotations as provenance or desktop links', () => {
    expect(isAnnotatedWorkspace({ config: { version: '2' }, hasTaskLink: false })).toBe(true);
    expect(isAnnotatedWorkspace({ config: null, hasTaskLink: true })).toBe(true);
    expect(isAnnotatedWorkspace({ config: null, isProjectRepository: true })).toBe(true);
    expect(isAnnotatedWorkspace({ config: null })).toBe(false);
  });
});
