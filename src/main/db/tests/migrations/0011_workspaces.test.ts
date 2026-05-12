import { openFixture } from '@tooling/utils/db';
import { afterEach, describe, expect, it } from 'vitest';

describe('0011 workspaces migration', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  afterEach(() => {
    fixture?.close();
  });

  it('creates the workspaces table with all expected columns', async () => {
    fixture = await openFixture('pre-0011');

    const tables = fixture.sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as { name: string }[];

    expect(tables.map((t) => t.name)).toContain('workspaces');
  });

  it('workspaces table has the expected columns', async () => {
    fixture = await openFixture('pre-0011');

    const columns = fixture.sqlite.prepare(`PRAGMA table_info(workspaces)`).all() as {
      name: string;
      notnull: number;
      dflt_value: string | null;
    }[];

    const colNames = columns.map((c) => c.name);
    expect(colNames).toContain('id');
    expect(colNames).toContain('key');
    expect(colNames).toContain('type');
    expect(colNames).toContain('data');
    expect(colNames).toContain('path');
    expect(colNames).toContain('created_at');
    expect(colNames).toContain('updated_at');

    const typeCol = columns.find((c) => c.name === 'type')!;
    expect(typeCol.notnull).toBe(1);

    const keyCol = columns.find((c) => c.name === 'key')!;
    expect(keyCol.notnull).toBe(0);
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

  it('existing data is preserved after migration', async () => {
    fixture = await openFixture('pre-0011');

    const projects = fixture.sqlite.prepare(`SELECT COUNT(*) as count FROM projects`).get() as {
      count: number;
    };

    expect(projects.count).toBeGreaterThan(0);
  });
});
