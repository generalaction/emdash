import { hostRef, LOCAL_HOST_REF, type HostRef } from '@emdash/core/primitives/host/api';
import type { WorkspaceRecord } from '@emdash/core/runtimes/workspace-registry/api';
import type { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import { err, ok } from '@emdash/shared';
import { openFixture } from '@tooling/utils/db';
import { eq, like } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  conversationRegistryTable as conversations,
  createConversationRegistry,
} from '@core/features/conversations/api/node/registry';
import { createWorkspaceRegistry } from '@core/features/workspaces/api/node/registry';
import { workspacePathIdentityKey } from '@core/features/workspaces/api/workspace-path-identity';
import {
  automations,
  kv,
  notifications,
  projectRemotes,
  projects,
  projectSettings,
  tasks,
  terminals,
  type WorkspaceInsert,
} from '@core/services/app-db/node/schema';
import type { WorkspaceRegistryRuntimeClient } from '@core/services/runtime-broker/api/clients';
import { applyWorkspaceRegistrySnapshot } from './apply-workspace-registry-snapshot';
import { WorkspaceRegistryBackfillService } from './workspace-registry-backfill';

function hostRecord(
  id: string,
  path: string,
  kind: WorkspaceRecord['kind'] = 'repository',
  parentId: string | null = null,
  observedStatus: WorkspaceRecord['observedStatus'] = 'present'
): WorkspaceRecord {
  return {
    id,
    kind,
    path,
    parentId,
    origin: 'registered',
    gitAdminName: null,
    observedStatus,
    creation: null,
    lastCreateOutcome: null,
    lifecycle: null,
    lastRemovalAttempt: null,
    git: null,
    lastActivatedAt: null,
    createdAt: 1,
    updatedAt: 1,
    lastObservedAt: 1,
    config: null,
    runtime: null,
  };
}

describe('WorkspaceRegistryBackfillService', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;
  let hostByPath: Map<string, WorkspaceRecord>;
  let kindByPath: Map<string, WorkspaceRecord['kind']>;
  let parentByPath: Map<string, string | null>;
  let missingPaths: Set<string>;
  let reachable: boolean;
  let throwNextCreate: boolean;
  let rejectNextCreate: boolean;
  let errors: string[];
  let createWorkspace: ReturnType<typeof vi.fn<WorkspaceRegistryRuntimeClient['createWorkspace']>>;
  let service: WorkspaceRegistryBackfillService;

  beforeEach(async () => {
    fixture = await openFixture('empty');
    hostByPath = new Map();
    kindByPath = new Map();
    parentByPath = new Map();
    missingPaths = new Set();
    reachable = true;
    throwNextCreate = false;
    rejectNextCreate = false;
    errors = [];
    createWorkspace = vi.fn(async (input: { workspaceId: string; path: string }) => {
      if (throwNextCreate) {
        throwNextCreate = false;
        throw new Error('transport dropped');
      }
      if (rejectNextCreate) {
        rejectNextCreate = false;
        return err({
          type: 'immutable-field-mismatch' as const,
          workspaceId: input.workspaceId,
          message: 'id already belongs to another path',
        });
      }
      const existing = [...hostByPath.values()].find((record) => record.id === input.workspaceId);
      if (
        existing &&
        workspacePathIdentityKey(existing.path) !== workspacePathIdentityKey(input.path)
      ) {
        return err({
          type: 'immutable-field-mismatch' as const,
          workspaceId: input.workspaceId,
          message: 'id already belongs to another path',
        });
      }
      const canonical = [...hostByPath.values()].find(
        (record) => workspacePathIdentityKey(record.path) === workspacePathIdentityKey(input.path)
      );
      if (canonical) return ok(canonical);
      if (missingPaths.has(input.path)) {
        return err({ type: 'path-not-found' as const, path: input.path });
      }
      const record = hostRecord(
        input.workspaceId,
        input.path,
        kindByPath.get(input.path) ?? 'repository',
        parentByPath.get(input.path) ?? null
      );
      hostByPath.set(input.path, record);
      return ok(record);
    });
    const broker = {
      client: async () =>
        reachable
          ? ok({ workspaceRegistry: { createWorkspace } })
          : err({ type: 'host-unavailable', message: 'offline' }),
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
    createWorkspaceRegistry(fixture.db).recordCreationIntent({
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

  function seedProject(projectId: string, repositoryWorkspaceId: string | null = null): void {
    fixture.db
      .insert(projects)
      .values({ id: projectId, name: projectId, repositoryWorkspaceId })
      .run();
  }

  function seedTask(taskId: string, projectId: string, workspaceId: string): void {
    fixture.db
      .insert(tasks)
      .values({ id: taskId, projectId, name: taskId, status: 'running', workspaceId })
      .run();
  }

  async function run(host: HostRef = LOCAL_HOST_REF) {
    return service.backfillHost(host);
  }

  function seedAliases(reverse = false): void {
    const rows = [
      ['a', 'E:\\AI\\X'],
      ['b', 'E:/AI/X'],
    ];
    for (const [id, path] of reverse ? [...rows].reverse() : rows) {
      // Shipped raw-path uniqueness allowed aliases that today's Registry rejects.
      fixture.sqlite
        .prepare(
          `INSERT INTO workspaces (id, type, kind, location, path, created_at, updated_at)
         VALUES (?, 'local', 'repository', 'local', ?, '2020-01-01', '2020-01-01')`
        )
        .run(id, path);
    }
  }

  it('translates legacy ids to Host canonical ids and moves every desktop binding', async () => {
    const config = {
      version: '2' as const,
      git: { kind: 'none' as const },
      workspace: { kind: 'new-worktree' as const },
    };
    seedRow('legacy-repo', { kind: 'repository', path: '/repo', config });
    seedRow('child', {
      path: '/work/child',
      parentId: 'legacy-repo',
      config: null,
      origin: 'registered',
    });
    seedProject('project', 'legacy-repo');
    seedTask('task', 'project', 'legacy-repo');
    hostByPath.set('/repo', hostRecord('canonical-repo', '/repo'));
    hostByPath.set('/work/child', hostRecord('child', '/work/child', 'worktree', 'canonical-repo'));

    await expect(run()).resolves.toEqual({ status: 'complete' });

    const registry = createWorkspaceRegistry(fixture.db);
    expect(registry.getLive('legacy-repo')).toBeUndefined();
    expect(registry.getLive('canonical-repo')).toMatchObject({ path: '/repo', config });
    expect(registry.getLive('child')).toMatchObject({ parentId: 'canonical-repo' });
    expect(fixture.db.select().from(projects).get()?.repositoryWorkspaceId).toBe('canonical-repo');
    expect(fixture.db.select().from(tasks).get()?.workspaceId).toBe('canonical-repo');
  });

  it('rejects a canonical id registered at a genuinely different directory', async () => {
    seedRow('legacy-repo', { kind: 'repository', path: '/repo' });
    seedRow('canonical-repo', { kind: 'repository', path: '/other' });
    seedProject('project', 'legacy-repo');
    seedProject('other-project', 'canonical-repo');
    hostByPath.set('/repo', hostRecord('canonical-repo', '/repo'));

    await expect(run()).resolves.toMatchObject({ status: 'terminal-failure' });

    const registry = createWorkspaceRegistry(fixture.db);
    expect(registry.getLive('legacy-repo')).toMatchObject({ path: '/repo' });
    expect(registry.getLive('canonical-repo')).toMatchObject({ path: '/other' });
    expect(fixture.db.select().from(projects).get()?.repositoryWorkspaceId).toBe('legacy-repo');
    expect(hostByPath.has('/other')).toBe(false);
  });

  it.each([false, true])(
    'consolidates Windows aliases before ordinary sync (reverse=%s)',
    async (reverse) => {
      seedAliases(reverse);
      seedProject('project-a', 'a');
      seedProject('project-b', 'b');
      seedTask('task-a', 'project-a', 'a');
      seedTask('task-b', 'project-b', 'b');
      seedRow('child', { path: 'E:/AI/child', parentId: 'b' });
      seedRow('unrelated', { kind: 'repository', path: 'E:/AI/Unrelated' });
      hostByPath.set('E:/AI/X', hostRecord('b', 'E:/AI/X'));
      parentByPath.set('E:/AI/child', 'b');

      await expect(run()).resolves.toEqual({ status: 'complete' });
      const registry = createWorkspaceRegistry(fixture.db);
      expect(registry.getLive('a')).toBeUndefined();
      expect(registry.getLive('b')).toMatchObject({ path: 'E:/AI/X' });
      expect(registry.getLive('child')).toMatchObject({ parentId: 'b' });
      expect(fixture.db.select().from(tasks).all()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'task-a', projectId: 'project-b', workspaceId: 'b' }),
          expect.objectContaining({ id: 'task-b', projectId: 'project-b', workspaceId: 'b' }),
        ])
      );
      expect(
        fixture.db
          .select()
          .from(projects)
          .all()
          .filter((row) => row.deletedAt === null)
      ).toEqual([expect.objectContaining({ id: 'project-b', repositoryWorkspaceId: 'b' })]);
      await expect(
        applyWorkspaceRegistrySnapshot({
          db: fixture.db,
          host: { location: 'local', sshConnectionId: null },
          records: Object.fromEntries(
            [...hostByPath.values()].map((record) => [record.id, record])
          ),
        })
      ).resolves.toBeDefined();
      expect(registry.getLive('unrelated')).toBeDefined();
      expect(errors).toEqual([]);
      createWorkspace.mockClear();
      await expect(run()).resolves.toEqual({ status: 'complete' });
      expect(createWorkspace).not.toHaveBeenCalled();
    }
  );

  it('preserves project contents, settings and embedded references when consolidating', async () => {
    seedAliases();
    seedProject('project-a', 'a');
    seedProject('project-b', 'b');
    seedTask('task', 'project-a', 'a');
    const config = {
      version: '2' as const,
      git: { kind: 'none' as const },
      workspace: { kind: 'repository-instance' as const, workspaceId: 'a' },
    };
    const registry = createWorkspaceRegistry(fixture.db);
    registry.updateConfig('a', config);
    registry.updateConfig('b', { ...config, git: { kind: 'use-branch', branchName: 'main' } });
    seedRow('child', { path: 'E:/AI/child', parentId: 'a', config });
    const settingsA = {
      tmux: true,
      worktreeRoot: 'E:/work',
      githubAccount: { kind: 'account', accountId: 'old' },
    };
    const settingsB = { tmux: false, githubAccount: { kind: 'none' } };
    for (const [projectId, base, shareable] of [
      [
        'project-a',
        settingsA,
        { scripts: { setup: 'setup-a', run: 'run-a' }, preservePatterns: ['a'] },
      ],
      ['project-b', settingsB, { scripts: { setup: 'setup-b' }, preservePatterns: [] }],
    ] as const) {
      fixture.db
        .insert(projectSettings)
        .values({
          projectId,
          baseProjectSettingsJson: JSON.stringify(base),
          shareableProjectSettingsJson: JSON.stringify(shareable),
        })
        .run();
    }
    fixture.db
      .insert(projectRemotes)
      .values([
        { projectId: 'project-a', remoteName: 'origin', remoteUrl: 'old' },
        { projectId: 'project-a', remoteName: 'upstream', remoteUrl: 'upstream' },
        { projectId: 'project-b', remoteName: 'origin', remoteUrl: 'current' },
      ])
      .run();
    createConversationRegistry(fixture.db).register({
      id: 'conversation',
      projectId: 'project-a',
      taskId: 'task',
      title: 'Keep this conversation',
    });
    fixture.db
      .insert(terminals)
      .values({
        id: 'terminal',
        projectId: 'project-a',
        taskId: 'task',
        name: 'Keep this terminal',
      })
      .run();
    fixture.db
      .insert(automations)
      .values({
        id: 'automation',
        name: 'Keep this automation',
        projectId: 'project-a',
        createdAt: 1,
        updatedAt: 1,
        taskConfig: {
          version: '1',
          taskConfig: { version: '1', name: 'Run' },
          workspaceConfig: config,
        },
      })
      .run();
    fixture.db
      .insert(notifications)
      .values({
        id: 'notification',
        kind: 'task',
        groupKey: 'task',
        title: 'Done',
        body: '',
        createdAt: 1,
        payload: {
          version: '1',
          target: { kind: 'task', projectId: 'project-a', taskId: 'task' },
          source: {
            kind: 'conversation',
            projectId: 'project-a',
            taskId: 'task',
            conversationId: 'conversation',
          },
          sound: null,
        },
      })
      .run();
    hostByPath.set('E:/AI/X', hostRecord('b', 'E:/AI/X'));
    parentByPath.set('E:/AI/child', 'b');

    await expect(run()).resolves.toEqual({ status: 'complete' });
    expect(fixture.db.select().from(conversations).get()).toMatchObject({
      id: 'conversation',
      projectId: 'project-b',
      taskId: 'task',
      title: 'Keep this conversation',
    });
    expect(fixture.db.select().from(terminals).get()).toMatchObject({
      id: 'terminal',
      projectId: 'project-b',
      taskId: 'task',
    });
    expect(fixture.db.select().from(automations).get()).toMatchObject({
      id: 'automation',
      projectId: 'project-b',
      taskConfig: { workspaceConfig: { workspace: { workspaceId: 'b' } } },
    });
    expect(fixture.db.select().from(automations).get()?.revision).toBeGreaterThan(1);
    expect(fixture.db.select().from(notifications).get()?.payload).toMatchObject({
      target: { projectId: 'project-b' },
      source: { projectId: 'project-b' },
    });
    expect(registry.getLive('child')).toMatchObject({
      parentId: 'b',
      config: { workspace: { workspaceId: 'b' } },
    });
    expect(registry.getLive('b')?.config).toMatchObject({
      git: { kind: 'use-branch', branchName: 'main' },
      workspace: { workspaceId: 'b' },
    });
    const settings = fixture.db
      .select()
      .from(projectSettings)
      .where(eq(projectSettings.projectId, 'project-b'))
      .get();
    expect(JSON.parse(settings!.baseProjectSettingsJson)).toEqual({
      ...settingsB,
      worktreeRoot: 'E:/work',
    });
    expect(JSON.parse(settings!.shareableProjectSettingsJson)).toEqual({
      scripts: { setup: 'setup-b', run: 'run-a' },
      preservePatterns: [],
    });
    expect(
      fixture.db
        .select()
        .from(projectRemotes)
        .where(eq(projectRemotes.projectId, 'project-b'))
        .all()
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ remoteName: 'origin', remoteUrl: 'current' }),
        expect.objectContaining({ remoteName: 'upstream', remoteUrl: 'upstream' }),
      ])
    );
    const recovery = fixture.db
      .select()
      .from(kv)
      .where(eq(kv.key, 'workspace-registry-backfill-recovery:local:local:b'))
      .get();
    expect(JSON.parse(recovery!.value)).toMatchObject({
      canonicalId: 'b',
      workspaces: expect.arrayContaining([
        expect.objectContaining({ id: 'a', config: JSON.stringify(config) }),
      ]),
      settings: expect.arrayContaining([
        expect.objectContaining({
          projectId: 'project-a',
          baseProjectSettingsJson: JSON.stringify(settingsA),
        }),
      ]),
    });
  });

  it.each([false, true])(
    'chooses a stable project when the canonical id is new (reverse=%s)',
    async (reverse) => {
      seedAliases(reverse);
      seedProject('project-a', 'a');
      seedProject('project-b', 'b');
      fixture.db
        .update(projects)
        .set({ createdAt: '2010-01-01' })
        .where(eq(projects.id, 'project-b'))
        .run();
      hostByPath.set('E:/AI/X', hostRecord('host-id', 'E:/AI/X'));
      await expect(run()).resolves.toEqual({ status: 'complete' });
      expect(
        fixture.db
          .select()
          .from(projects)
          .all()
          .filter((row) => row.deletedAt === null)
      ).toEqual([expect.objectContaining({ id: 'project-b', repositoryWorkspaceId: 'host-id' })]);
      expect(createWorkspaceRegistry(fixture.db).getLive('host-id')).toBeDefined();
    }
  );

  it('rolls back consolidation and recovery data together, then retries Host registrations', async () => {
    seedAliases();
    seedProject('project-a', 'a');
    seedProject('project-b', 'b');
    seedTask('task', 'project-b', 'b');
    fixture.sqlite.exec(
      `CREATE TRIGGER fail_binding BEFORE UPDATE OF workspace_id ON tasks BEGIN SELECT RAISE(ABORT, 'injected binding failure'); END`
    );
    await expect(run()).resolves.toMatchObject({ status: 'retry-needed' });
    expect(
      fixture.db.select().from(kv).where(like(kv.key, 'workspace-registry-backfill%')).all()
    ).toEqual([]);
    expect(
      fixture.db
        .select()
        .from(projects)
        .all()
        .every((row) => row.deletedAt === null)
    ).toBe(true);
    expect(createWorkspaceRegistry(fixture.db).getLive('b')).toBeDefined();
    fixture.sqlite.exec('DROP TRIGGER fail_binding');
    await expect(run()).resolves.toEqual({ status: 'complete' });
    expect(fixture.db.select().from(tasks).get()).toMatchObject({
      projectId: 'project-a',
      workspaceId: 'a',
    });
  });

  it('retries after the Host registers an alias but the response is lost', async () => {
    seedAliases();
    const create = createWorkspace.getMockImplementation()!;
    createWorkspace.mockImplementationOnce(async (input) => {
      await create(input);
      throw new Error('response lost');
    });
    await expect(run()).resolves.toMatchObject({ status: 'retry-needed' });
    expect(createWorkspaceRegistry(fixture.db).getLive('b')).toBeDefined();
    expect(
      fixture.db.select().from(kv).where(like(kv.key, 'workspace-registry-backfill%')).all()
    ).toEqual([]);
    await expect(run()).resolves.toEqual({ status: 'complete' });
    expect(createWorkspaceRegistry(fixture.db).getLive('b')).toBeUndefined();
    expect(hostByPath.size).toBe(1);
  });

  it('retries after consolidation commits but recording completion fails', async () => {
    seedAliases();
    seedProject('project-a', 'a');
    seedProject('project-b', 'b');
    fixture.sqlite.exec(`CREATE TRIGGER fail_completion BEFORE INSERT ON kv
      WHEN NEW.key = 'workspace-registry-backfill:local:local'
      BEGIN SELECT RAISE(ABORT, 'injected completion failure'); END`);
    await expect(run()).resolves.toMatchObject({ status: 'retry-needed' });
    expect(createWorkspaceRegistry(fixture.db).getLive('b')).toBeUndefined();
    const recoveryKey = 'workspace-registry-backfill-recovery:local:local:a';
    const recovery = fixture.db.select().from(kv).where(eq(kv.key, recoveryKey)).get();
    expect(recovery).toBeDefined();
    fixture.sqlite.exec('DROP TRIGGER fail_completion');
    await expect(run()).resolves.toEqual({ status: 'complete' });
    expect(fixture.db.select().from(kv).where(eq(kv.key, recoveryKey)).get()).toEqual(recovery);
    expect(
      fixture.db
        .select()
        .from(projects)
        .all()
        .filter((row) => row.deletedAt === null)
    ).toEqual([expect.objectContaining({ id: 'project-a', repositoryWorkspaceId: 'a' })]);
  });

  it('refuses to claim a canonical UUID already attached to a different Host', async () => {
    fixture.sqlite
      .prepare(
        `INSERT INTO ssh_connections (id, name, host, username) VALUES ('remote', 'remote', 'example.test', 'user')`
      )
      .run();
    seedRow('remote-id', {
      kind: 'repository',
      location: 'remote',
      sshConnectionId: 'remote',
      path: '/repo',
    });
    seedRow('local-id', { kind: 'repository', path: '/repo' });
    hostByPath.set('/repo', hostRecord('remote-id', '/repo'));
    await expect(run()).resolves.toMatchObject({ status: 'retry-needed' });
    expect(createWorkspaceRegistry(fixture.db).getLive('remote-id')).toMatchObject({
      location: 'remote',
      sshConnectionId: 'remote',
    });
    expect(createWorkspaceRegistry(fixture.db).getLive('local-id')).toBeDefined();
  });

  it('does not consolidate or retire a pending deletion', async () => {
    seedAliases();
    const registry = createWorkspaceRegistry(fixture.db);
    registry.tombstone('b', {
      version: '1',
      targetRecordId: 'b',
      tombstonedAt: 1,
      options: { deleteBranch: false, deleteConversations: false },
    });
    await expect(run()).resolves.toMatchObject({ status: 'terminal-failure' });
    expect(registry.getLive('a')).toBeDefined();
    expect(registry.getLive('b')?.deletionTombstone?.targetRecordId).toBe('b');
    expect(createWorkspace).not.toHaveBeenCalled();
    expect(
      fixture.db.select().from(kv).where(like(kv.key, 'workspace-registry-backfill%')).all()
    ).toEqual([]);
  });

  it('uses Host resolution for aliases that lexical normalization cannot identify', async () => {
    seedRow('alias', { kind: 'repository', path: '/symlink' });
    seedRow('real', { kind: 'repository', path: '/real' });
    seedProject('project', 'alias');
    // The Host resolves the symlink; the desktop cannot infer this from the strings.
    createWorkspace.mockImplementation(async () => ok(hostRecord('canonical', '/real')));
    await expect(run()).resolves.toEqual({ status: 'complete' });
    const registry = createWorkspaceRegistry(fixture.db);
    expect(registry.getLive('alias')).toBeUndefined();
    expect(registry.getLive('real')).toBeUndefined();
    expect(registry.getLive('canonical')).toMatchObject({ path: '/real' });
    expect(fixture.db.select().from(projects).get()?.repositoryWorkspaceId).toBe('canonical');
  });

  it('retains a canonical mirror that would otherwise have been retired', async () => {
    seedRow('legacy', { kind: 'worktree', path: '/work/../work/child' });
    fixture.sqlite
      .prepare(
        `INSERT INTO workspaces (id, type, kind, location, path, config, origin)
       VALUES ('canonical', 'local', 'worktree', 'local', '/work/child', NULL, 'adopted')`
      )
      .run();
    hostByPath.set('/work/child', hostRecord('canonical', '/work/child', 'worktree'));
    await expect(run()).resolves.toEqual({ status: 'complete' });
    const registry = createWorkspaceRegistry(fixture.db);
    expect(registry.getLive('legacy')).toBeUndefined();
    expect(registry.getLive('canonical')).toMatchObject({ path: '/work/child' });
  });

  it('keeps the same directory on local and two remote Hosts as three projects', async () => {
    for (const host of ['local', 'remote-1', 'remote-2']) {
      if (host !== 'local') {
        fixture.sqlite
          .prepare(
            `INSERT INTO ssh_connections (id, name, host, username) VALUES (?, ?, 'example.test', 'user')`
          )
          .run(host, host);
      }
      seedRow(host, {
        kind: 'repository',
        path: '/repo',
        location: host === 'local' ? 'local' : 'remote',
        sshConnectionId: host === 'local' ? null : host,
      });
      seedProject(`project-${host}`, host);
    }
    for (const host of ['local', 'remote-1', 'remote-2']) {
      // Each Host has its own registry, even when the path strings are identical.
      hostByPath.clear();
      await expect(
        run(host === 'local' ? LOCAL_HOST_REF : hostRef('remote', host))
      ).resolves.toEqual({ status: 'complete' });
    }
    expect(
      fixture.db
        .select()
        .from(projects)
        .all()
        .filter((row) => row.deletedAt === null)
    ).toHaveLength(3);
    for (const host of ['local', 'remote-1', 'remote-2']) {
      expect(createWorkspaceRegistry(fixture.db).getLive(host)).toMatchObject({
        path: '/repo',
        sshConnectionId: host === 'local' ? null : host,
      });
    }
  });

  it('replans if a legacy row changes while Host registration is in flight', async () => {
    seedRow('repo', { kind: 'repository', path: '/repo' });
    const create = createWorkspace.getMockImplementation()!;
    createWorkspace.mockImplementationOnce(async (input) => {
      const result = await create(input);
      createWorkspaceRegistry(fixture.db).updateConfig('repo', null);
      return result;
    });
    await expect(run()).resolves.toMatchObject({ status: 'retry-needed' });
    await expect(run()).resolves.toEqual({ status: 'complete' });
  });

  it('preserves parent closure and registers parents before their worktrees', async () => {
    const registry = createWorkspaceRegistry(fixture.db);
    registry.adopt({
      id: 'legacy-parent',
      type: 'local',
      kind: null,
      location: 'local',
      path: '/repo',
    });
    registry.adopt({
      id: 'legacy-child',
      type: 'local',
      kind: null,
      location: 'local',
      parentId: 'legacy-parent',
      path: '/work/child',
    });
    seedProject('project');
    seedTask('task', 'project', 'legacy-child');
    kindByPath.set('/repo', 'repository');
    kindByPath.set('/work/child', 'worktree');
    parentByPath.set('/work/child', 'legacy-parent');

    await expect(run()).resolves.toEqual({ status: 'complete' });

    expect(createWorkspace.mock.calls.slice(0, 2).map(([input]) => input.workspaceId)).toEqual([
      'legacy-parent',
      'legacy-child',
    ]);
    expect(registry.getLive('legacy-parent')).toMatchObject({ kind: 'repository' });
    expect(registry.getLive('legacy-child')).toMatchObject({
      kind: 'worktree',
      parentId: 'legacy-parent',
    });
  });

  it('preserves repository and directory roots but retires reconstructible mirror rows', async () => {
    const registry = createWorkspaceRegistry(fixture.db);
    registry.adopt({
      id: 'repository',
      type: 'local',
      kind: 'repository',
      location: 'local',
      path: '/repo',
    });
    registry.adopt({
      id: 'directory',
      type: 'local',
      kind: 'directory',
      location: 'local',
      path: '/dir',
    });
    registry.adopt({
      id: 'mirror-worktree',
      type: 'local',
      kind: 'worktree',
      location: 'local',
      path: '/work/mirror',
    });
    kindByPath.set('/dir', 'directory');

    await expect(run()).resolves.toEqual({ status: 'complete' });

    expect(createWorkspace.mock.calls.slice(0, 2).map(([input]) => input.workspaceId)).toEqual([
      'directory',
      'repository',
    ]);
    expect(registry.getLive('mirror-worktree')).toBeUndefined();
  });

  it('skips a missing production path without manufacturing Host state', async () => {
    seedRow('missing-repo', { kind: 'repository', path: '/gone/repo' });
    missingPaths.add('/gone/repo');

    await expect(run()).resolves.toEqual({ status: 'complete' });

    expect(hostByPath.has('/gone/repo')).toBe(false);
    expect(createWorkspaceRegistry(fixture.db).getLive('missing-repo')).toBeDefined();
    expect(errors).toEqual(['workspace registry backfill skipped missing (missing-repo)']);

    createWorkspace.mockClear();
    await expect(run()).resolves.toEqual({ status: 'complete' });
    expect(createWorkspace).not.toHaveBeenCalled();
  });

  it('skips a pathless legacy row without blocking the Host attachment', async () => {
    seedRow('pathless', { kind: 'worktree', path: null });

    await expect(run()).resolves.toEqual({ status: 'complete' });

    expect(createWorkspace).not.toHaveBeenCalled();
    expect(createWorkspaceRegistry(fixture.db).getLive('pathless')).toBeDefined();
    expect(errors).toEqual(['workspace registry backfill skipped pathless (pathless)']);
  });

  it('does not write completion on a transport failure and retries the whole obligation', async () => {
    seedRow('repo', { kind: 'repository', path: '/repo' });
    throwNextCreate = true;

    await expect(run()).resolves.toMatchObject({ status: 'retry-needed' });
    expect(errors).toEqual(['workspace registry backfill retry-needed (local:local)']);

    await expect(run()).resolves.toEqual({ status: 'complete' });
    createWorkspace.mockClear();
    await expect(run()).resolves.toEqual({ status: 'complete' });
    expect(createWorkspace).not.toHaveBeenCalled();
  });

  it('gates snapshot attachment on terminal identity failures', async () => {
    seedRow('repo', { kind: 'repository', path: '/repo' });
    rejectNextCreate = true;

    await expect(run()).resolves.toMatchObject({ status: 'terminal-failure' });
    expect(errors).toEqual(['workspace registry backfill terminal-failure (local:local)']);

    await expect(run()).resolves.toEqual({ status: 'complete' });
    expect(createWorkspace).toHaveBeenCalledTimes(3);
  });

  it.each([1, { version: 2, completedAt: 1 }])(
    'repairs an older completion marker (%j)',
    async (marker) => {
      seedAliases();
      fixture.sqlite
        .prepare(`INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)`)
        .run('workspace-registry-backfill:local:local', JSON.stringify(marker), Date.now());

      await expect(run()).resolves.toEqual({ status: 'complete' });
      expect(createWorkspace).toHaveBeenCalled();
      expect(createWorkspaceRegistry(fixture.db).getLive('b')).toBeUndefined();

      createWorkspace.mockClear();
      await expect(run()).resolves.toEqual({ status: 'complete' });
      expect(createWorkspace).not.toHaveBeenCalled();
    }
  );

  it('keeps local and remote obligations independent and retries unreachable hosts', async () => {
    fixture.sqlite
      .prepare(
        `INSERT INTO ssh_connections (id, name, host, username) VALUES (?, ?, 'example.test', 'user')`
      )
      .run('ssh-1', 'ssh-1');
    seedRow('remote-repo', {
      kind: 'repository',
      location: 'remote',
      sshConnectionId: 'ssh-1',
      path: '/remote/repo',
    });
    reachable = false;

    await expect(run(hostRef('remote', 'ssh-1'))).resolves.toEqual({
      status: 'retry-needed',
      message: 'offline',
    });
    expect(createWorkspace).not.toHaveBeenCalled();

    reachable = true;
    await expect(run()).resolves.toEqual({ status: 'complete' });
    expect(createWorkspace).not.toHaveBeenCalled();
    await expect(run(hostRef('remote', 'ssh-1'))).resolves.toEqual({ status: 'complete' });
    expect(createWorkspace).toHaveBeenCalledWith({
      workspaceId: 'remote-repo',
      path: '/remote/repo',
    });
  });
});
