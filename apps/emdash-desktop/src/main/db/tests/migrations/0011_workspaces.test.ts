import { openFixture } from '@tooling/utils/db';
import { afterEach, describe, expect, it } from 'vitest';

describe('0011 workspaces migration', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  afterEach(() => {
    fixture?.close();
  });

  it('creates the workspaces table', async () => {
    fixture = await openFixture('pre-0011');

    const tables = fixture.sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as { name: string }[];

    expect(tables.map((t) => t.name)).toContain('workspaces');
  });

  it('workspaces table has all expected columns including git stats', async () => {
    fixture = await openFixture('pre-0011');

    const columns = fixture.sqlite.prepare(`PRAGMA table_info(workspaces)`).all() as {
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
    }[];

    const colNames = columns.map((c) => c.name);
    expect(colNames).toContain('id');
    expect(colNames).toContain('key');
    expect(colNames).toContain('type');
    expect(colNames).toContain('data');
    expect(colNames).toContain('path');
    expect(colNames).toContain('lines_added');
    expect(colNames).toContain('lines_deleted');
    expect(colNames).toContain('created_at');
    expect(colNames).toContain('updated_at');

    const typeCol = columns.find((c) => c.name === 'type')!;
    expect(typeCol.notnull).toBe(1);

    const keyCol = columns.find((c) => c.name === 'key')!;
    expect(keyCol.notnull).toBe(0);

    const linesAdded = columns.find((c) => c.name === 'lines_added')!;
    expect(linesAdded.notnull).toBe(0);
    expect(linesAdded.dflt_value).toBeNull();

    const linesDeleted = columns.find((c) => c.name === 'lines_deleted')!;
    expect(linesDeleted.notnull).toBe(0);
    expect(linesDeleted.dflt_value).toBeNull();
  });

  it('workspaces table has a partial unique index on key', async () => {
    fixture = await openFixture('pre-0011');

    const indexes = fixture.sqlite
      .prepare(`SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='workspaces'`)
      .all() as { name: string; sql: string }[];

    const keyIndex = indexes.find((i) => i.name === 'idx_workspaces_key');
    expect(keyIndex).toBeDefined();
    expect(keyIndex!.sql).toMatch(/where/i);
    expect(keyIndex!.sql).toMatch(/is not null/i);
  });

  it('lines_added and lines_deleted default to null for new rows', async () => {
    fixture = await openFixture('pre-0011');

    fixture.sqlite
      .prepare(
        `INSERT INTO workspaces (id, type, created_at, updated_at) VALUES ('test-ws', 'local', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      )
      .run();

    const row = fixture.sqlite
      .prepare(`SELECT lines_added, lines_deleted FROM workspaces WHERE id = 'test-ws'`)
      .get() as { lines_added: number | null; lines_deleted: number | null };

    expect(row.lines_added).toBeNull();
    expect(row.lines_deleted).toBeNull();
  });

  it('existing data is preserved after migration', async () => {
    fixture = await openFixture('pre-0011');

    const projects = fixture.sqlite.prepare(`SELECT COUNT(*) as count FROM projects`).get() as {
      count: number;
    };

    expect(projects.count).toBeGreaterThan(0);
  });
});
