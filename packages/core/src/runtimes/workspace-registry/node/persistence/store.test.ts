import { describe, expect, it } from 'vitest';
import { POSIX_PATH_PROFILE, WIN32_PATH_PROFILE } from '#primitives/path/api';
import { WorkspaceRecordStore, type DurableWorkspaceRecord } from './record-store';
import { workspaceRecords } from './schema';
import { workspaceRegistryStore } from './store';

function repositoryRecord(): DurableWorkspaceRecord {
  return {
    id: 'repo-1',
    kind: 'repository',
    path: '/tmp/repo-1',
    parentId: null,
    origin: 'registered',
    gitAdminName: null,
    observedStatus: 'present',
    creation: null,
    lastCreateOutcome: null,
    lifecycle: null,
    lastRemovalAttempt: null,
    git: null,
    lastActivatedAt: null,
    createdAt: 1,
    updatedAt: 1,
    lastObservedAt: 1,
  };
}

describe('workspace registry settings persistence', () => {
  it('applies the fresh personal-config migration and round-trips its versioned payload', async () => {
    const handle = await workspaceRegistryStore.openTemp();
    try {
      const columns = handle.connection.native
        .prepare('PRAGMA table_info(workspace_records)')
        .all() as Array<{ name: string }>;
      const columnNames = columns.map(({ name }) => name);
      expect(columnNames).toContain('personal_config');
      expect(columnNames).toContain('legacy_desktop_settings_migrated');
      expect(columnNames).not.toContain('config_overlay');

      const records = new WorkspaceRecordStore(handle);
      records.insert(repositoryRecord());
      records.updatePersonalConfig('repo-1', {
        preservePatterns: [],
        scripts: { setup: 'pnpm install' },
        env: { CLAUDE_CONFIG_DIR: '/tmp/claude-project' },
        autoRunSetup: false,
      });

      const row = handle.connection.native
        .prepare(
          'SELECT personal_config, legacy_desktop_settings_migrated FROM workspace_records WHERE id = ?'
        )
        .get('repo-1') as {
        personal_config: string;
        legacy_desktop_settings_migrated: number;
      };
      expect(JSON.parse(row.personal_config)).toEqual({
        version: '2',
        value: {
          preservePatterns: [],
          scripts: { setup: 'pnpm install' },
          env: { CLAUDE_CONFIG_DIR: '/tmp/claude-project' },
          autoRunSetup: false,
        },
      });
      expect(row.legacy_desktop_settings_migrated).toBe(0);
      expect(records.getPersonalConfig('repo-1')).toEqual({
        preservePatterns: [],
        scripts: { setup: 'pnpm install' },
        env: { CLAUDE_CONFIG_DIR: '/tmp/claude-project' },
        autoRunSetup: false,
      });
    } finally {
      handle.close();
    }
  });

  it('uses Win32 path identity for lookup and admission while preserving display spelling', async () => {
    const handle = await workspaceRegistryStore.openTemp();
    try {
      const records = new WorkspaceRecordStore(handle, WIN32_PATH_PROFILE);
      records.insert({ ...repositoryRecord(), path: 'C:\\Repo' });

      expect(records.getByPath('c:\\repo')).toMatchObject({ path: 'C:\\Repo' });
      expect(() =>
        records.insert({ ...repositoryRecord(), id: 'repo-2', path: 'c:\\REPO' })
      ).toThrow('path identity collision');
    } finally {
      handle.close();
    }
  });

  it('keeps POSIX path admission case-sensitive', async () => {
    const handle = await workspaceRegistryStore.openTemp();
    try {
      const records = new WorkspaceRecordStore(handle, POSIX_PATH_PROFILE);
      records.insert({ ...repositoryRecord(), path: '/Repo' });
      records.insert({ ...repositoryRecord(), id: 'repo-2', path: '/repo' });

      expect(records.getByPath('/Repo')?.id).toBe('repo-1');
      expect(records.getByPath('/repo')?.id).toBe('repo-2');
    } finally {
      handle.close();
    }
  });

  it('reports existing casing collisions deterministically without deleting records', async () => {
    const handle = await workspaceRegistryStore.openTemp();
    try {
      handle.db
        .insert(workspaceRecords)
        .values([
          recordRow({ ...repositoryRecord(), path: 'C:\\Repo', createdAt: 2 }),
          recordRow({ ...repositoryRecord(), id: 'repo-2', path: 'c:\\repo', createdAt: 1 }),
        ])
        .run();
      const records = new WorkspaceRecordStore(handle, WIN32_PATH_PROFILE);

      expect(records.pathCollisions()).toEqual([
        {
          key: records.pathKey('C:\\Repo'),
          records: [
            expect.objectContaining({ id: 'repo-2', path: 'c:\\repo' }),
            expect.objectContaining({ id: 'repo-1', path: 'C:\\Repo' }),
          ],
        },
      ]);
      expect(records.list()).toHaveLength(2);
    } finally {
      handle.close();
    }
  });
});

function recordRow(record: DurableWorkspaceRecord): typeof workspaceRecords.$inferInsert {
  return {
    id: record.id,
    kind: record.kind,
    path: record.path,
    parentId: record.parentId,
    origin: record.origin,
    gitAdminName: record.gitAdminName,
    observedStatus: record.observedStatus,
    creation: null,
    lastCreateOutcome: null,
    background: null,
    lastRemovalAttempt: null,
    scriptOutcomes: null,
    git: null,
    personalConfig: null,
    legacyDesktopSettingsMigrated: false,
    lastActivatedAt: null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastObservedAt: record.lastObservedAt,
  };
}
