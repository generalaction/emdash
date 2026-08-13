import { openFixture } from '@tooling/utils/db';
import { afterEach, describe, expect, it } from 'vitest';
import { initializeDatabase } from '@main/db/initialize';

describe('palette search index rebuild', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  afterEach(() => {
    fixture?.close();
  });

  it('rebuilds the derived index so legacy command rows cannot survive', async () => {
    fixture = await openFixture('empty');
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
      value: '4',
    });
    expect(fixture.sqlite.prepare(`SELECT item_type FROM search_index`).all()).toEqual([]);
  });
});
