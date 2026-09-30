import { openFixture } from '@tooling/utils/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSearchService } from '@core/features/search/node/search-service';
import { conversations, projects, tasks } from '@core/services/app-db/node/schema';
import { initializeDatabase } from '@main/db/initialize';

describe('palette search index rebuild', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  afterEach(() => {
    fixture?.close();
  });

  it('rebuilds the derived index so legacy command rows cannot survive', async () => {
    fixture = await openFixture('empty');
    fixture.db.insert(projects).values({ id: 'project-1', name: 'Palette project' }).run();
    fixture.db
      .insert(tasks)
      .values({
        id: 'task-1',
        projectId: 'project-1',
        name: 'Theme task',
        status: 'running',
        linkedIssue: {
          provider: 'linear',
          url: 'https://linear.app/example/issue/THEME-123',
          title: 'Restore theme switching',
          identifier: 'THEME-123',
        },
      })
      .run();
    fixture.sqlite
      .prepare(
        `INSERT INTO search_index(item_type, item_id, project_id, task_id, title, keywords)
         VALUES ('command', 'app.toggleTheme', NULL, NULL, 'Toggle Theme', 'appearance')`
      )
      .run();
    fixture.sqlite
      .prepare(
        `INSERT OR REPLACE INTO kv (key, value, updated_at)
         VALUES ('fts_version', '3', unixepoch())`
      )
      .run();

    await initializeDatabase(fixture.sqlite);

    expect(fixture.sqlite.prepare(`SELECT value FROM kv WHERE key = 'fts_version'`).get()).toEqual({
      value: '5',
    });
    expect(fixture.sqlite.prepare(`SELECT item_type FROM search_index`).all()).toEqual([]);

    const service = createSearchService({
      db: fixture.db,
      sqlite: fixture.sqlite,
      acquireWorkspaceRuntime: async () => null,
      searchFileSearchRoot: async () => [],
      getSearchExclusions: async () => [],
      tasks: { on: vi.fn() } as never,
    });
    service.initialize();

    expect(
      fixture.sqlite
        .prepare(`SELECT item_type, keywords FROM search_index WHERE item_id = 'task-1'`)
        .get()
    ).toEqual({
      item_type: 'task',
      keywords: 'THEME-123 Restore theme switching',
    });
    await expect(
      service.searchEntities({
        kind: 'task',
        query: 'tt',
        context: { projectId: 'project-1' },
      })
    ).resolves.toMatchObject([
      {
        kind: 'task',
        id: 'task-1',
        title: 'Theme task',
        subtitle: 'THEME-123 Restore theme switching',
      },
    ]);
  });

  it('rebuilds version 4 duplicates from current records without changing source data', async () => {
    fixture = await openFixture('empty');
    fixture.db.insert(projects).values({ id: 'project-1', name: 'Triage Gamma' }).run();
    fixture.db
      .insert(tasks)
      .values({ id: 'task-1', projectId: 'project-1', name: 'Triage Gamma', status: 'running' })
      .run();
    fixture.db
      .insert(conversations)
      .values({
        id: 'conversation-1',
        projectId: 'project-1',
        taskId: 'task-1',
        title: 'Triage Gamma',
      })
      .run();
    const sourceRecords = () => ({
      projects: fixture.db.select().from(projects).all(),
      tasks: fixture.db.select().from(tasks).all(),
      conversations: fixture.db.select().from(conversations).all(),
    });
    const before = sourceRecords();
    fixture.sqlite.exec(`
      UPDATE kv SET value = '4' WHERE key = 'fts_version';
      INSERT INTO search_index VALUES
        ('project', 'project-1', NULL, NULL, 'Triage Alpha', '/old/alpha'),
        ('project', 'project-1', NULL, NULL, 'Triage Beta', '/old/beta'),
        ('task', 'task-1', 'project-1', NULL, 'Triage Alpha', 'Old issue'),
        ('task', 'task-1', 'project-1', NULL, 'Triage Beta', 'Old branch'),
        ('conversation', 'conversation-1', 'project-1', 'task-1', 'Triage Alpha', ''),
        ('conversation', 'conversation-1', 'project-1', 'task-1', 'Triage Beta', ''),
        ('task', 'deleted-task', 'project-1', NULL, 'Triage Deleted', '');
    `);

    await initializeDatabase(fixture.sqlite);
    const service = createSearchService({
      db: fixture.db,
      sqlite: fixture.sqlite,
      acquireWorkspaceRuntime: async () => null,
      searchFileSearchRoot: async () => [],
      getSearchExclusions: async () => [],
      tasks: { on: vi.fn() },
    });
    service.initialize();

    for (const kind of ['project', 'task', 'conversation'] as const) {
      const search = (query: string) =>
        service.searchEntities({
          kind,
          query,
          context: { projectId: 'project-1', taskId: 'task-1' },
        });
      await expect(search('Triage')).resolves.toEqual([
        expect.objectContaining({ id: `${kind}-1`, title: 'Triage Gamma' }),
      ]);
      for (const staleQuery of ['Alpha', 'Beta', 'Old', 'Deleted']) {
        await expect(search(staleQuery)).resolves.toEqual([]);
      }
    }
    const indexRows = () =>
      fixture.sqlite.prepare('SELECT * FROM search_index ORDER BY item_type, item_id').all();
    const rebuilt = indexRows();
    expect(rebuilt).toHaveLength(3);
    expect(sourceRecords()).toEqual(before);

    // A subsequent boot preserves the rebuilt index and the authoritative records.
    await initializeDatabase(fixture.sqlite);
    expect(indexRows()).toEqual(rebuilt);
    expect(sourceRecords()).toEqual(before);
  });
});
